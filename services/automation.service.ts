/**
 * Automation runtime — enrolls members in automations and executes their steps.
 *
 * Shape:
 *  - An Automation has ordered AutomationStep rows.
 *  - Each enrolled member walks the steps via AutomationEnrollment (currentStep, nextRunAt).
 *  - WAIT steps schedule nextRunAt; the cron runner picks them up.
 *  - SPLIT steps store branch decisions in AutomationEvent.detail.
 *  - GOAL conditions on the Automation cause early EXIT when matched.
 *
 * Triggers (handled by callers via `triggerAutomations`):
 *   SIGNUP, PAYMENT_FAILED, PAYMENT_SUCCESS, PLAN_CHANGE, FREEZE, CANCEL,
 *   DOC_SIGNED, DOC_EXPIRED, TAG_ADDED, TAG_REMOVED, STATUS_CHANGE,
 *   ATTENDANCE_MILESTONE, NO_SHOW, USAGE_TIER_CHANGE, CHURN_RISK_THRESHOLD,
 *   BIRTHDAY, ANNIVERSARY, SCHEDULED.
 */
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/notify";
import { sendQuoSms } from "@/lib/quo";
import { addMemberTag, removeMemberTag, updateMember } from "./member.service";
import { mergeFields } from "./marketing.service";

export type AutomationTrigger =
  | "SIGNUP" | "PAYMENT_FAILED" | "PAYMENT_SUCCESS"
  | "PLAN_CHANGE" | "FREEZE" | "CANCEL"
  | "DOC_SIGNED" | "DOC_EXPIRED"
  | "TAG_ADDED" | "TAG_REMOVED" | "STATUS_CHANGE"
  | "ATTENDANCE_MILESTONE" | "NO_SHOW"
  | "USAGE_TIER_CHANGE" | "CHURN_RISK_THRESHOLD"
  | "BIRTHDAY" | "ANNIVERSARY"
  | "SCHEDULED";

/**
 * Fan-out a trigger event: enroll matching members in any active Automation
 * whose `trigger` matches and whose `triggerConfig` allows the context.
 */
export async function triggerAutomations(opts: {
  trigger: AutomationTrigger;
  memberId: string;
  context?: Record<string, any>;
}) {
  const prisma = getPrisma();
  const automations = await prisma.automation.findMany({
    where: { trigger: opts.trigger, active: true },
  });
  for (const a of automations) {
    if (!matchesTriggerConfig(a.triggerConfig as any, opts.context)) continue;
    await enrollMember(a.id, opts.memberId).catch((e) =>
      console.warn("[automation] enroll failed", a.id, opts.memberId, e)
    );
  }
}

function matchesTriggerConfig(config: any, context?: Record<string, any>): boolean {
  if (!config || Object.keys(config).length === 0) return true;
  if (!context) return false;
  for (const [k, v] of Object.entries(config)) {
    if (context[k] !== v) return false;
  }
  return true;
}

export async function enrollMember(automationId: string, memberId: string) {
  const prisma = getPrisma();
  const existing = await prisma.automationEnrollment.findUnique({
    where: { automationId_memberId: { automationId, memberId } },
  });
  if (existing && existing.status === "ACTIVE") return existing;

  const enrollment = existing
    ? await prisma.automationEnrollment.update({
        where: { id: existing.id },
        data: { status: "ACTIVE", currentStep: 0, nextRunAt: new Date(), exitReason: null, completedAt: null },
      })
    : await prisma.automationEnrollment.create({
        data: { automationId, memberId, status: "ACTIVE", currentStep: 0, nextRunAt: new Date() },
      });

  void audit({
    action: "automation.enroll",
    entityType: "AutomationEnrollment",
    entityId: enrollment.id,
    metadata: { automationId, memberId },
  });

  return enrollment;
}

/**
 * Run all due steps. Cron: every minute.
 */
export async function runDueAutomationSteps(now = new Date()) {
  const prisma = getPrisma();
  const due = await prisma.automationEnrollment.findMany({
    where: { status: "ACTIVE", nextRunAt: { lte: now } },
    include: { automation: { include: { steps: { orderBy: { order: "asc" } } } }, member: true },
    take: 200,
  });

  let executed = 0;
  for (const e of due) {
    try {
      await runOneStep(e);
      executed++;
    } catch (err) {
      console.error("[automation] step failed", e.id, err);
      await prisma.automationEnrollment.update({
        where: { id: e.id },
        data: { status: "FAILED", exitReason: String((err as any)?.message ?? err) },
      });
      await prisma.automationEvent.create({
        data: { enrollmentId: e.id, step: e.currentStep, kind: "STEP_FAILED", detail: { error: String(err) } },
      });
    }
  }
  return executed;
}

async function runOneStep(enrollment: any) {
  const prisma = getPrisma();
  const steps = enrollment.automation.steps as any[];

  // Goal-met check before each step
  if (await goalMet(enrollment.automation, enrollment.member)) {
    await prisma.automationEnrollment.update({
      where: { id: enrollment.id },
      data: { status: "EXITED", exitReason: "goal-met", completedAt: new Date() },
    });
    await prisma.automationEvent.create({
      data: { enrollmentId: enrollment.id, step: enrollment.currentStep, kind: "EXITED", detail: { reason: "goal-met" } },
    });
    return;
  }

  const step = steps.find((s) => s.order === enrollment.currentStep);
  if (!step) {
    await prisma.automationEnrollment.update({
      where: { id: enrollment.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    return;
  }

  await prisma.automationEvent.create({
    data: { enrollmentId: enrollment.id, step: step.order, kind: "STEP_STARTED" },
  });

  const cfg = step.config as any;
  let waitUntil: Date | null = null;

  switch (step.kind) {
    case "SEND_EMAIL": {
      if (enrollment.member.optInEmailMarketing && enrollment.member.email) {
        const subject = cfg.subject ? mergeFields(cfg.subject, enrollment.member) : "";
        const body = cfg.body ? mergeFields(cfg.body, enrollment.member) : "";
        await sendEmail({ to: enrollment.member.email, subject, html: body });
      }
      break;
    }
    case "SEND_SMS": {
      if (enrollment.member.optInSmsMarketing && enrollment.member.phone) {
        const body = cfg.body ? mergeFields(cfg.body, enrollment.member) : "";
        await sendQuoSms({ to: enrollment.member.phone, text: body });
      }
      break;
    }
    case "ADD_TAG": {
      if (cfg.tagId) await addMemberTag(enrollment.memberId, cfg.tagId);
      break;
    }
    case "REMOVE_TAG": {
      if (cfg.tagId) await removeMemberTag(enrollment.memberId, cfg.tagId);
      break;
    }
    case "CHANGE_STATUS": {
      if (cfg.status) await updateMember(enrollment.memberId, { status: cfg.status });
      break;
    }
    case "WEBHOOK": {
      if (cfg.url) {
        await fetch(cfg.url, {
          method: cfg.method ?? "POST",
          headers: { "Content-Type": "application/json", ...(cfg.headers ?? {}) },
          body: JSON.stringify({ memberId: enrollment.memberId, ...(cfg.payload ?? {}) }),
        }).catch((e) => console.warn("[automation] webhook failed", cfg.url, e));
      }
      break;
    }
    case "WAIT": {
      const minutes = Number(cfg.minutes ?? 0);
      const hours = Number(cfg.hours ?? 0);
      const days = Number(cfg.days ?? 0);
      const ms = minutes * 60_000 + hours * 3_600_000 + days * 86_400_000;
      waitUntil = new Date(Date.now() + ms);
      break;
    }
    case "SPLIT": {
      // Evaluate cfg.condition.path on member; cfg.equal vs cfg.notEqual
      // If matched, jump to cfg.thenStep, else cfg.elseStep
      const value = cfg.path ? mergeFields(`{{${cfg.path}}}`, enrollment.member) : "";
      const matches = (cfg.equal != null && String(cfg.equal) === value) ||
                      (cfg.notEqual != null && String(cfg.notEqual) !== value);
      const next = matches ? cfg.thenStep : cfg.elseStep;
      if (typeof next === "number") {
        await prisma.automationEnrollment.update({
          where: { id: enrollment.id },
          data: { currentStep: next, nextRunAt: new Date() },
        });
        return;
      }
      break;
    }
    case "EXIT": {
      await prisma.automationEnrollment.update({
        where: { id: enrollment.id },
        data: { status: "EXITED", exitReason: cfg.reason ?? "exit-step", completedAt: new Date() },
      });
      await prisma.automationEvent.create({
        data: { enrollmentId: enrollment.id, step: step.order, kind: "EXITED", detail: { reason: cfg.reason } },
      });
      return;
    }
  }

  await prisma.automationEvent.create({
    data: { enrollmentId: enrollment.id, step: step.order, kind: "STEP_COMPLETED" },
  });

  // Advance to next step
  await prisma.automationEnrollment.update({
    where: { id: enrollment.id },
    data: {
      currentStep: enrollment.currentStep + 1,
      nextRunAt: waitUntil ?? new Date(),
    },
  });
}

async function goalMet(automation: any, member: any): Promise<boolean> {
  const goal = automation.goalConfig as any;
  if (!goal) return false;
  switch (goal.kind) {
    case "STATUS": return member.status === goal.value;
    case "TAG_ADDED": {
      const prisma = getPrisma();
      const t = await prisma.memberTag.findFirst({ where: { memberId: member.id, tagId: goal.tagId } });
      return !!t;
    }
    default: return false;
  }
}
