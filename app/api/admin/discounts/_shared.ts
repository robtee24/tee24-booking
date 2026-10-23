import type { DiscountScope, DiscountType } from "@/services/discount.service";
import { parseDate } from "../billing/_shared";

/** Normalise a JSON body into `DiscountInput`-shaped values (undefined = not provided). */
export function discountBodyToInput(body: Record<string, unknown>) {
  const num = (v: unknown) => (v === undefined ? undefined : v === null || v === "" ? null : Math.round(Number(v)));
  const str = (v: unknown) => (v === undefined ? undefined : v === null ? null : String(v));
  return {
    code: body.code as string | undefined,
    name: body.name as string | undefined,
    type: (body.type as DiscountType) ?? undefined,
    value: body.value === undefined ? undefined : Number(body.value),
    scope: (body.scope as DiscountScope) ?? undefined,
    recurringMonths: num(body.recurringMonths),
    maxRedemptions: num(body.maxRedemptions),
    perMemberLimit: num(body.perMemberLimit),
    startsAt: body.startsAt === undefined ? undefined : parseDate(body.startsAt),
    endsAt: body.endsAt === undefined ? undefined : parseDate(body.endsAt),
    active: typeof body.active === "boolean" ? body.active : undefined,
    signupFormIds: body.signupFormIds === undefined ? undefined : Array.isArray(body.signupFormIds) ? (body.signupFormIds as string[]) : null,
    planIds: body.planIds === undefined ? undefined : Array.isArray(body.planIds) ? (body.planIds as string[]) : null,
    // Signup promotion
    showOnSignup: typeof body.showOnSignup === "boolean" ? body.showOnSignup : undefined,
    signupTitle: str(body.signupTitle),
    signupDescription: str(body.signupDescription),
    requiresIdUpload: typeof body.requiresIdUpload === "boolean" ? body.requiresIdUpload : undefined,
    idUploadLabel: str(body.idUploadLabel),
    commitmentMonths: num(body.commitmentMonths),
    commitmentAcknowledgement: str(body.commitmentAcknowledgement),
    earlyCancelPolicy: body.earlyCancelPolicy === undefined ? undefined : body.earlyCancelPolicy === "CHARGE_DISCOUNT_BACK" || body.earlyCancelPolicy === "NONE" ? (body.earlyCancelPolicy as "CHARGE_DISCOUNT_BACK" | "NONE") : null,
    sortOrder: body.sortOrder === undefined ? undefined : Math.round(Number(body.sortOrder) || 0),
  };
}
