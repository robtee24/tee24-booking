/**
 * Automation runtime — enrolls members in automations and executes their steps.
 *
 * Shape:
 *  - An Automation has ordered AutomationStep rows.
 *  - Each enrolled member walks the steps via AutomationEnrollment (currentStep, nextRunAt).
 *  - WAIT steps schedule nextRunAt; the cron runner picks them up.
 *  - SPLIT steps evaluate a condition; branch A continues, branch B exits or jumps.
 *  - GOAL conditions on the Automation cause early EXIT when matched.
 *
 * Triggers (Automation.trigger):
 *   • any MemberEventKind from lib/events.ts  (e.g. "member.created", "payment.failed")
 *   • "tag.added"          triggerConfig.tagId (optional; any tag when empty)
 *   • "inactive-for-days"  triggerConfig.days  (evaluated daily by runInactivityTriggers)
 *   • "manual"             only via the admin "Enroll member" action
 *   Legacy UPPERCASE triggers (SIGNUP, PAYMENT_FAILED, ...) are mapped in LEGACY_TRIGGER_MAP.
 *
 * triggerConfig: { planIds?: string[]; tagId?: string; days?: number; exitOnCancel?: boolean }
 */
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { adminNotify } from "@/lib/admin-notify";
import { deliverEmail, deliverSms } from "@/lib/notify";
import type { MemberEventKind } from "@/lib/events";
import { addMemberTag, removeMemberTag, updateMember } from "./member.service";
import { mergeFields } from "./marketing.service";

export type AutomationTrigger = MemberEventKind | "tag.added" | "inactive-for-days" | "manual";

export const LEGACY_TRIGGER_MAP: Record<string, AutomationTrigger> = {
  SIGNUP: "member.signup",
  PAYMENT_FAILED: "payment.failed",
  PAYMENT_SUCCESS: "payment.succeeded",
  CANCEL: "membership.cancelled",
  FREEZE: "membership.frozen",
  DOC_SIGNED: "document.signed",
  DOC_EXPIRED: "document.expired",
  TAG_ADDED: "tag.added",
  BIRTHDAY: "member.birthday",
};

export function normalizeTrigger(t: string): AutomationTrigger {
  return (LEGACY_TRIGGER_MAP[t] ?? t) as AutomationTrigger;
}

export type AutomationStepKind =
  | "SEND_EMAIL" | "SEND_SMS" | "WAIT" | "ADD_TAG" | "REMOVE_TAG" | "CHANGE_STATUS"
  | "CREATE_TASK" | "WEBHOOK" | "SPLIT" | "EXIT";

export const AUTOMATION_STEP_KINDS: AutomationStepKind[] = [
  "SEND_EMAIL", "SEND_SMS", "WAIT", "ADD_TAG", "REMOVE_TAG", "CHANGE_STATUS", "CREATE_TASK", "WEBHOOK", "SPLIT", "EXIT",
];

export type TriggerConfig = { planIds?: string[]; tagId?: string; days?: number; exitOnCancel?: boolean };

export type AutomationStepInput = { order?: number; kind: AutomationStepKind; config: Record<string, any> };

export type AutomationInput = {
  organizationId?: string | null;
  name: string;
  description?: string | null;
  trigger: string;
  triggerConfig?: TriggerConfig | null;
  goalConfig?: Record<string, any> | null;
  active?: boolean;
  maxSteps?: number;
  steps?: AutomationStepInput[];
};

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createAutomation(input: AutomationInput, actorId?: string) {
  const prisma = getPrisma();
  const a = await prisma.automation.create({
    data: {
      organizationId: input.organizationId ?? null,
      name: input.name.trim(),
      description: input.description ?? null,
      trigger: normalizeTrigger(input.trigger),
      triggerConfig: (input.triggerConfig ?? {}) as any,
      goalConfig: (input.goalConfig ?? undefined) as any,
      active: input.active ?? false,
      maxSteps: input.maxSteps ?? 50,
      steps: input.steps?.length
        ? { create: input.steps.map((s, i) => ({ order: s.order ?? i, kind: s.kind, config: s.config ?? {} })) }
        : undefined,
    },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  void audit({ actorId, organizationId: input.organizationId ?? null, action: "settings.update", entityType: "Automation", entityId: a.id, after: a });
  return a;
}

/** Update an automation; when `steps` is provided the whole step list is replaced. */
export async function updateAutomation(id: string, patch: Partial<AutomationInput>, actorId?: string) {
  const prisma = getPrisma();
  const before = await prisma.automation.findUnique({ where: { id }, include: { steps: true } });
  if (!before) throw new Error("Automation not found");

  const a = await prisma.$transaction(async (tx) => {
    if (patch.steps) {
      await tx.automationStep.deleteMany({ where: { automationId: id } });
      await tx.automationStep.createMany({
        data: patch.steps.map((s, i) => ({ automationId: id, order: s.order ?? i, kind: s.kind, config: s.config ?? {} })),
      });
    }
    return tx.automation.update({
      where: { id },
      data: {
        name: patch.name?.trim(),
        description: patch.description === undefined ? undefined : patch.description,
        trigger: patch.trigger ? normalizeTrigger(patch.trigger) : undefined,
        triggerConfig: patch.triggerConfig === undefined ? undefined : ((patch.triggerConfig ?? {}) as any),
        goalConfig: patch.goalConfig === undefined ? undefined : ((patch.goalConfig ?? null) as any),
        active: patch.active,
        maxSteps: patch.maxSteps,
      },
      include: { steps: { orderBy: { order: "asc" } } },
    });
  });
  void audit({
    actorId,
    organizationId: before.organizationId,
    action: patch.active === false && before.active ? "automation.pause" : "settings.update",
    entityType: "Automation",
    entityId: id,
    before: { name: before.name, active: before.active, trigger: before.trigger },
    after: { name: a.name, active: a.active, trigger: a.trigger },
  });
  return a;
}

export async function deleteAutomation(id: string, actorId?: string) {
  const prisma = getPrisma();
  const before = await prisma.automation.findUnique({ where: { id } });
  if (!before) return;
  await prisma.automation.delete({ where: { id } });
  void audit({ actorId, organizationId: before.organizationId, action: "settings.update", entityType: "Automation", entityId: id, before, metadata: { deleted: true } });
}

export async function duplicateAutomation(id: string, actorId?: string) {
  const prisma = getPrisma();
  const src = await prisma.automation.findUnique({ where: { id }, include: { steps: { orderBy: { order: "asc" } } } });
  if (!src) throw new Error("Automation not found");
  return createAutomation(
    {
      organizationId: src.organizationId,
      name: `${src.name} (copy)`,
      description: src.description,
      trigger: src.trigger,
      triggerConfig: (src.triggerConfig as any) ?? {},
      goalConfig: (src.goalConfig as any) ?? null,
      active: false,
      maxSteps: src.maxSteps,
      steps: src.steps.map((s) => ({ order: s.order, kind: s.kind as AutomationStepKind, config: s.config as any })),
    },
    actorId,
  );
}

export async function setAllAutomationsActive(organizationId: string | null, active: boolean, actorId?: string) {
  const prisma = getPrisma();
  const res = await prisma.automation.updateMany({
    where: { OR: [{ organizationId }, { organizationId: null }] },
    data: { active },
  });
  void audit({ actorId, organizationId, action: active ? "settings.update" : "automation.pause", entityType: "Automation", entityId: "all", metadata: { count: res.count, active } });
  return res.count;
}

/** Enrollment / completion stats for the detail page. */
export async function automationStats(automationId: string, days = 30) {
  const prisma = getPrisma();
  const since = new Date(Date.now() - days * 86_400_000);
  const [total, active, completed, exited, failed, recent] = await Promise.all([
    prisma.automationEnrollment.count({ where: { automationId } }),
    prisma.automationEnrollment.count({ where: { automationId, status: "ACTIVE" } }),
    prisma.automationEnrollment.count({ where: { automationId, status: "COMPLETED" } }),
    prisma.automationEnrollment.count({ where: { automationId, status: "EXITED" } }),
    prisma.automationEnrollment.count({ where: { automationId, status: "FAILED" } }),
    prisma.automationEnrollment.findMany({ where: { automationId, enrolledAt: { gte: since } }, select: { enrolledAt: true, status: true } }),
  ]);
  const byDay = new Map<string, number>();
  for (const r of recent) {
    const k = r.enrolledAt.toISOString().slice(0, 10);
    byDay.set(k, (byDay.get(k) ?? 0) + 1);
  }
  const series: { date: string; enrolled: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    series.push({ date: d, enrolled: byDay.get(d) ?? 0 });
  }
  return { total, active, completed, exited, failed, last30: recent.length, series };
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

/**
 * Fan-out a trigger event: enroll matching members in any active Automation
 * whose `trigger` matches and whose `triggerConfig` allows the context.
 */
export async function triggerAutomations(opts: {
  trigger: string;
  memberId: string;
  context?: { planId?: string | null; tagId?: string | null; organizationId?: string | null; [k: string]: any };
}) {
  const prisma = getPrisma();
  const trigger = normalizeTrigger(opts.trigger);
  // Match both the normalised name and any legacy alias stored on old rows.
  const aliases = [trigger, ...Object.entries(LEGACY_TRIGGER_MAP).filter(([, v]) => v === trigger).map(([k]) => k)];
  const automations = await prisma.automation.findMany({ where: { trigger: { in: aliases }, active: true } });
  if (automations.length === 0) return 0;

  const member = await prisma.member.findUnique({
    where: { id: opts.memberId },
    select: {
      id: true,
      organizationId: true,
      membershipSubscriptions: { where: { status: { in: ["ACTIVE", "FROZEN", "CANCEL_SCHEDULED", "PENDING"] } }, select: { planId: true } },
    },
  });
  if (!member) return 0;

  let enrolled = 0;
  for (const a of automations) {
    if (a.organizationId && member.organizationId && a.organizationId !== member.organizationId) continue;
    if (!matchesTriggerConfig((a.triggerConfig as TriggerConfig | null) ?? {}, { member, context: opts.context })) continue;
    try {
      await enrollMember(a.id, opts.memberId);
      enrolled++;
    } catch (e) {
      console.warn("[automation] enroll failed", a.id, opts.memberId, e);
    }
  }
  return enrolled;
}

function matchesTriggerConfig(
  cfg: TriggerConfig,
  input: { member: { membershipSubscriptions: { planId: string }[] }; context?: Record<string, any> },
): boolean {
  if (cfg.planIds?.length) {
    const planIds = new Set(input.member.membershipSubscriptions.map((s) => s.planId));
    if (input.context?.planId) planIds.add(input.context.planId);
    if (![...planIds].some((p) => cfg.planIds!.includes(p))) return false;
  }
  if (cfg.tagId && input.context?.tagId && cfg.tagId !== input.context.tagId) return false;
  return true;
}

/**
 * Daily: enroll members with no visit in `triggerConfig.days` days into
 * "inactive-for-days" automations (once per member per automation).
 */
export async function runInactivityTriggers(now = new Date()) {
  const prisma = getPrisma();
  const automations = await prisma.automation.findMany({ where: { trigger: "inactive-for-days", active: true } });
  let enrolled = 0;
  for (const a of automations) {
    const cfg = (a.triggerConfig as TriggerConfig | null) ?? {};
    const days = Number(cfg.days ?? 30);
    if (!days || days < 1) continue;
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const members = await prisma.member.findMany({
      where: {
        status: "ACTIVE",
        mergedIntoId: null,
        ...(a.organizationId ? { organizationId: a.organizationId } : {}),
        visits: { none: { enteredAt: { gte: cutoff } } },
        automationEnrollments: { none: { automationId: a.id } },
        ...(cfg.planIds?.length ? { membershipSubscriptions: { some: { planId: { in: cfg.planIds }, status: { in: ["ACTIVE", "FROZEN"] } } } } : {}),
      },
      select: { id: true },
      take: 500,
    });
    for (const m of members) {
      await enrollMember(a.id, m.id).catch(() => {});
      enrolled++;
    }
  }
  return enrolled;
}

export async function enrollMember(automationId: string, memberId: string, actorId?: string) {
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

  void audit({ actorId, action: "automation.enroll", entityType: "AutomationEnrollment", entityId: enrollment.id, metadata: { automationId, memberId } });
  return enrollment;
}

export async function removeEnrollment(enrollmentId: string, actorId?: string, reason = "removed-by-admin") {
  const prisma = getPrisma();
  const e = await prisma.automationEnrollment.update({
    where: { id: enrollmentId },
    data: { status: "EXITED", exitReason: reason, completedAt: new Date(), nextRunAt: null },
  });
  await prisma.automationEvent.create({ data: { enrollmentId, step: e.currentStep, kind: "EXITED", detail: { reason } } });
  void audit({ actorId, action: "automation.exit", entityType: "AutomationEnrollment", entityId: enrollmentId, metadata: { reason } });
  return e;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Run all due steps. Cron: every minute (or every 5 minutes).
 */
export async function runDueAutomationSteps(now = new Date()) {
  const prisma = getPrisma();
  const due = await prisma.automationEnrollment.findMany({
    where: { status: "ACTIVE", nextRunAt: { lte: now } },
    include: {
      automation: { include: { steps: { orderBy: { order: "asc" } } } },
      member: { include: { location: { select: { name: true, slug: true, timezone: true } } } },
    },
    take: 200,
  });

  let executed = 0;
  for (const e of due) {
    if (!e.automation.active) {
      // Paused automation — push forward and skip without failing.
      await prisma.automationEnrollment.update({ where: { id: e.id }, data: { nextRunAt: new Date(now.getTime() + 15 * 60_000) } });
      continue;
    }
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
      void adminNotify({
        organizationId: e.automation.organizationId,
        kind: "automation.failed",
        severity: "WARN",
        title: `Automation "${e.automation.name}" failed`,
        body: String((err as any)?.message ?? err).slice(0, 200),
        data: { automationId: e.automationId, enrollmentId: e.id, memberId: e.memberId },
      });
    }
  }
  return executed;
}

/** Combined cron entry point: due steps + daily inactivity triggers. */
export async function runAutomationTick(now = new Date()) {
  const executed = await runDueAutomationSteps(now);
  // Inactivity triggers are cheap enough to evaluate once an hour; callers may
  // also invoke runInactivityTriggers() directly on a daily schedule.
  let inactivityEnrolled = 0;
  if (now.getMinutes() < 5) inactivityEnrolled = await runInactivityTriggers(now);
  return { executed, inactivityEnrolled };
}

async function exitEnrollment(enrollmentId: string, step: number, reason: string) {
  const prisma = getPrisma();
  await prisma.automationEnrollment.update({
    where: { id: enrollmentId },
    data: { status: "EXITED", exitReason: reason, completedAt: new Date(), nextRunAt: null },
  });
  await prisma.automationEvent.create({ data: { enrollmentId, step, kind: "EXITED", detail: { reason } } });
}

async function runOneStep(enrollment: any) {
  const prisma = getPrisma();
  const automation = enrollment.automation;
  const member = enrollment.member;
  const steps = automation.steps as any[];
  const cfgTrigger = (automation.triggerConfig as TriggerConfig | null) ?? {};

  // Safety: stop if the member was cancelled/merged and the flow asks for it.
  if (member.mergedIntoId) return exitEnrollment(enrollment.id, enrollment.currentStep, "member-merged");
  if (cfgTrigger.exitOnCancel && member.status === "CANCELLED" && automation.trigger !== "membership.cancelled") {
    return exitEnrollment(enrollment.id, enrollment.currentStep, "member-cancelled");
  }

  // Safety: max steps executed per enrollment (guards against SPLIT loops).
  const executedCount = await prisma.automationEvent.count({ where: { enrollmentId: enrollment.id, kind: "STEP_STARTED" } });
  if (executedCount >= (automation.maxSteps ?? 50)) return exitEnrollment(enrollment.id, enrollment.currentStep, "max-steps");

  // Goal-met check before each step
  if (await goalMet(automation, member)) return exitEnrollment(enrollment.id, enrollment.currentStep, "goal-met");

  const step = steps.find((s) => s.order === enrollment.currentStep);
  if (!step) {
    await prisma.automationEnrollment.update({
      where: { id: enrollment.id },
      data: { status: "COMPLETED", completedAt: new Date(), nextRunAt: null },
    });
    return;
  }

  await prisma.automationEvent.create({ data: { enrollmentId: enrollment.id, step: step.order, kind: "STEP_STARTED" } });

  const cfg = (step.config ?? {}) as any;
  let waitUntil: Date | null = null;
  let jumpTo: number | null = null;

  switch (step.kind as AutomationStepKind) {
    case "SEND_EMAIL": {
      if (!member.optInEmailMarketing || !member.email) break; // honour opt-out
      let subject = cfg.subject ?? "";
      let body = cfg.body ?? "";
      if (cfg.templateId) {
        const t = await prisma.messageTemplate.findUnique({ where: { id: cfg.templateId } });
        if (t) {
          subject = t.subject ?? subject;
          body = t.body;
        }
      }
      subject = mergeFields(subject, member);
      body = mergeFields(body, member);
      const msg = await prisma.message.create({
        data: { memberId: member.id, channel: "EMAIL", direction: "OUTBOUND", status: "QUEUED", category: "MARKETING", subject, body, toAddress: member.email, templateId: cfg.templateId ?? null, sentByAutomationId: automation.id },
      });
      const res = await deliverEmail({ to: member.email, subject, html: body, category: "MARKETING", organizationId: member.organizationId });
      await prisma.message.update({ where: { id: msg.id }, data: { status: res.ok ? "SENT" : res.skipped ? "QUEUED" : "FAILED", providerId: res.providerId ?? null, providerError: res.ok ? null : res.error ?? null } });
      break;
    }
    case "SEND_SMS": {
      if (!member.optInSmsMarketing || !member.phone) break; // honour opt-out
      let body = cfg.body ?? "";
      if (cfg.templateId) {
        const t = await prisma.messageTemplate.findUnique({ where: { id: cfg.templateId } });
        if (t) body = t.body;
      }
      body = mergeFields(body, member);
      const msg = await prisma.message.create({
        data: { memberId: member.id, channel: "SMS", direction: "OUTBOUND", status: "QUEUED", category: "MARKETING", body, toAddress: member.phone, templateId: cfg.templateId ?? null, sentByAutomationId: automation.id },
      });
      const res = await deliverSms({ to: member.phone, text: body, category: "MARKETING", organizationId: member.organizationId, timeZone: member.location?.timezone });
      if (res.deferredUntil) {
        // Quiet hours: re-run this same step when the window opens.
        await prisma.message.update({ where: { id: msg.id }, data: { scheduledFor: res.deferredUntil } });
        await prisma.automationEvent.create({ data: { enrollmentId: enrollment.id, step: step.order, kind: "STEP_COMPLETED", detail: { deferredUntil: res.deferredUntil } } });
      } else {
        await prisma.message.update({ where: { id: msg.id }, data: { status: res.ok ? "SENT" : res.skipped ? "QUEUED" : "FAILED", providerId: res.providerId ?? null, providerError: res.ok ? null : res.error ?? null } });
      }
      break;
    }
    case "ADD_TAG": {
      if (cfg.tagId) await addMemberTag(member.id, cfg.tagId);
      break;
    }
    case "REMOVE_TAG": {
      if (cfg.tagId) await removeMemberTag(member.id, cfg.tagId).catch(() => {});
      break;
    }
    case "CHANGE_STATUS": {
      if (cfg.status) await updateMember(member.id, { status: cfg.status });
      break;
    }
    case "CREATE_TASK": {
      const dueInDays = Number(cfg.dueInDays ?? 0);
      const task = await prisma.task.create({
        data: {
          organizationId: member.organizationId ?? automation.organizationId ?? null,
          locationId: member.locationId ?? null,
          memberId: member.id,
          title: mergeFields(cfg.title ?? `Follow up with {first_name} {last_name}`, member),
          body: cfg.body ? mergeFields(cfg.body, member) : `Created by automation "${automation.name}"`,
          assignedToId: cfg.assignedToId ?? null,
          priority: cfg.priority ?? "NORMAL",
          dueAt: dueInDays > 0 ? new Date(Date.now() + dueInDays * 86_400_000) : null,
          status: "OPEN",
        },
      });
      if (cfg.assignedToId) {
        void adminNotify({
          organizationId: task.organizationId,
          locationId: task.locationId,
          kind: "task.assigned",
          title: task.title,
          body: task.body ?? undefined,
          data: { taskId: task.id, memberId: member.id, automationId: automation.id, assignedToId: cfg.assignedToId },
        });
      }
      break;
    }
    case "WEBHOOK": {
      if (cfg.url) {
        let payload: any = {};
        if (typeof cfg.payload === "string") {
          try { payload = JSON.parse(cfg.payload); } catch { payload = { raw: cfg.payload }; }
        } else if (cfg.payload && typeof cfg.payload === "object") payload = cfg.payload;
        await fetch(cfg.url, {
          method: cfg.method ?? "POST",
          headers: { "Content-Type": "application/json", ...(cfg.headers ?? {}) },
          body: JSON.stringify({ memberId: member.id, email: member.email, phone: member.phone, firstName: member.firstName, lastName: member.lastName, automationId: automation.id, ...payload }),
        }).catch((e) => console.warn("[automation] webhook failed", cfg.url, e));
      }
      break;
    }
    case "WAIT": {
      const minutes = Number(cfg.minutes ?? 0);
      const hours = Number(cfg.hours ?? 0);
      const days = Number(cfg.days ?? 0);
      const ms = minutes * 60_000 + hours * 3_600_000 + days * 86_400_000;
      waitUntil = new Date(Date.now() + Math.max(ms, 60_000));
      break;
    }
    case "SPLIT": {
      const matched = await evaluateSplit(cfg, member);
      await prisma.automationEvent.create({ data: { enrollmentId: enrollment.id, step: step.order, kind: "STEP_COMPLETED", detail: { split: cfg.condition?.kind ?? cfg.path, matched } } });
      if (matched) {
        // Branch A: continue to the next step
        break;
      }
      // Branch B: exit or jump
      const elseAction = cfg.elseAction ?? (typeof cfg.elseStep === "number" ? "JUMP" : "EXIT");
      if (elseAction === "JUMP" && typeof cfg.elseStep === "number") {
        jumpTo = cfg.elseStep;
        break;
      }
      return exitEnrollment(enrollment.id, step.order, "split-no-match");
    }
    case "EXIT": {
      return exitEnrollment(enrollment.id, step.order, cfg.reason ?? "exit-step");
    }
  }

  if (step.kind !== "SPLIT") {
    await prisma.automationEvent.create({ data: { enrollmentId: enrollment.id, step: step.order, kind: "STEP_COMPLETED" } });
  }

  // Advance
  await prisma.automationEnrollment.update({
    where: { id: enrollment.id },
    data: {
      currentStep: jumpTo ?? enrollment.currentStep + 1,
      nextRunAt: waitUntil ?? new Date(),
    },
  });
}

/**
 * SPLIT condition config:
 *   { condition: { kind: "HAS_TAG", tagId } | { kind: "PLAN", planId } | { kind: "OPENED_LAST_EMAIL" } | { kind: "STATUS", status },
 *     elseAction: "EXIT" | "JUMP", elseStep?: number }
 * Legacy: { path, equal | notEqual, thenStep, elseStep }
 */
async function evaluateSplit(cfg: any, member: any): Promise<boolean> {
  const prisma = getPrisma();
  const c = cfg.condition;
  if (c?.kind) {
    switch (c.kind) {
      case "HAS_TAG": {
        if (!c.tagId) return false;
        return !!(await prisma.memberTag.findFirst({ where: { memberId: member.id, tagId: c.tagId } }));
      }
      case "PLAN": {
        if (!c.planId) return false;
        return !!(await prisma.membershipSubscription.findFirst({ where: { memberId: member.id, planId: c.planId, status: { in: ["ACTIVE", "FROZEN", "CANCEL_SCHEDULED"] } } }));
      }
      case "OPENED_LAST_EMAIL": {
        const last = await prisma.message.findFirst({ where: { memberId: member.id, channel: "EMAIL", direction: "OUTBOUND" }, orderBy: { createdAt: "desc" } });
        return !!last?.openedAt;
      }
      case "STATUS":
        return member.status === c.status;
      default:
        return false;
    }
  }
  // Legacy path/equal
  if (cfg.path) {
    const value = mergeFields(`{{${cfg.path}}}`, member);
    return (cfg.equal != null && String(cfg.equal) === value) || (cfg.notEqual != null && String(cfg.notEqual) !== value);
  }
  return false;
}

async function goalMet(automation: any, member: any): Promise<boolean> {
  const goal = automation.goalConfig as any;
  if (!goal || !goal.kind) return false;
  switch (goal.kind) {
    case "STATUS": return member.status === goal.value;
    case "TAG_ADDED": {
      const prisma = getPrisma();
      const t = await prisma.memberTag.findFirst({ where: { memberId: member.id, tagId: goal.tagId } });
      return !!t;
    }
    case "PAYMENT_SUCCEEDED": {
      const prisma = getPrisma();
      const since = new Date(Date.now() - 30 * 86_400_000);
      const c = await prisma.charge.findFirst({ where: { memberId: member.id, status: { in: ["SUCCEEDED", "PAID", "COMPLETED"] }, createdAt: { gte: since } } }).catch(() => null);
      return !!c;
    }
    default: return false;
  }
}

// ---------------------------------------------------------------------------
// Prebuilt gallery
// ---------------------------------------------------------------------------

export type AutomationPreset = { key: string; name: string; description: string; input: Omit<AutomationInput, "organizationId"> };

export const AUTOMATION_PRESETS: AutomationPreset[] = [
  {
    key: "welcome-series",
    name: "New member welcome series",
    description: "Welcome email on day 0, tips SMS on day 2, check-in email on day 7 with a task if they haven't visited.",
    input: {
      name: "New member welcome series",
      description: "3-touch onboarding for new members.",
      trigger: "member.created",
      triggerConfig: { exitOnCancel: true },
      active: false,
      steps: [
        { kind: "SEND_EMAIL", config: { subject: "Welcome to {location_name}, {first_name}!", body: "Hi {first_name},<br><br>We're thrilled to have you. Here's how to get the most out of your membership:<br>• Book bays any time from the portal: {portal_url}<br>• Your check-in code is {checkin_code}<br>• Bring a friend — share your referral code {referral_code}<br><br>See you on the sim!" } },
        { kind: "WAIT", config: { days: 2 } },
        { kind: "SEND_SMS", config: { body: "Hi {first_name}! Quick tip from {location_name}: off-peak mornings are the easiest time to grab a bay. Book here: {portal_url}" } },
        { kind: "WAIT", config: { days: 5 } },
        { kind: "SEND_EMAIL", config: { subject: "How's your first week going, {first_name}?", body: "Hi {first_name},<br><br>You've been a member for a week! Anything we can help with? Just reply to this email.<br><br>— The {location_name} team" } },
        { kind: "CREATE_TASK", config: { title: "Welcome check-in call: {first_name} {last_name}", body: "New member is one week in — give them a quick call to see how it's going.", dueInDays: 1, priority: "NORMAL" } },
      ],
    },
  },
  {
    key: "win-back",
    name: "Cancelled member win-back",
    description: "30 days after cancellation, a come-back offer by email; a reminder SMS two weeks later if they're still gone.",
    input: {
      name: "Cancelled member win-back",
      description: "Re-engage members who cancelled.",
      trigger: "membership.cancelled",
      triggerConfig: {},
      goalConfig: { kind: "STATUS", value: "ACTIVE" },
      active: false,
      steps: [
        { kind: "WAIT", config: { days: 30 } },
        { kind: "SEND_EMAIL", config: { subject: "We miss you at {location_name}, {first_name}", body: "Hi {first_name},<br><br>It's been a month since you left and the bays aren't the same without you. Come back this month and we'll waive your signup fee.<br><br>Rejoin: {portal_url}" } },
        { kind: "WAIT", config: { days: 14 } },
        { kind: "SPLIT", config: { condition: { kind: "STATUS", status: "CANCELLED" }, elseAction: "EXIT" } },
        { kind: "SEND_SMS", config: { body: "{first_name}, your come-back offer at {location_name} ends soon — rejoin with no signup fee: {portal_url}" } },
      ],
    },
  },
  {
    key: "payment-failed",
    name: "Payment failed follow-up",
    description: "Immediate email, SMS the next day, then a staff task on day 3 if still unpaid.",
    input: {
      name: "Payment failed follow-up",
      description: "Dunning sequence for declined cards.",
      trigger: "payment.failed",
      triggerConfig: {},
      goalConfig: { kind: "PAYMENT_SUCCEEDED" },
      active: false,
      steps: [
        { kind: "SEND_EMAIL", config: { subject: "Action needed: your payment didn't go through", body: "Hi {first_name},<br><br>Your latest payment to {location_name} was declined. Please update your card so your access isn't interrupted: {portal_url}" } },
        { kind: "WAIT", config: { days: 1 } },
        { kind: "SEND_SMS", config: { body: "Hi {first_name}, your payment to {location_name} failed. Update your card here to keep your access: {portal_url}" } },
        { kind: "WAIT", config: { days: 2 } },
        { kind: "CREATE_TASK", config: { title: "Failed payment follow-up: {first_name} {last_name}", body: "Card declined 3 days ago and still unpaid. Call the member.", dueInDays: 0, priority: "HIGH" } },
      ],
    },
  },
];

export async function createAutomationFromPreset(key: string, organizationId: string | null, actorId?: string) {
  const preset = AUTOMATION_PRESETS.find((p) => p.key === key);
  if (!preset) throw new Error("Unknown preset");
  return createAutomation({ ...preset.input, organizationId }, actorId);
}
