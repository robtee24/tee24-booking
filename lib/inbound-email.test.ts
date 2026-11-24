import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyInboundEmail } from "./inbound-email";

describe("classifyInboundEmail", () => {
  beforeEach(() => {
    vi.stubEnv("EMAIL_REPLY_DOMAIN", "notifications.tee24.golf");
    vi.stubEnv("EMAIL_REPLY_TO", "");
    vi.stubEnv("RESEND_FROM", "");
    vi.stubEnv("RESEND_FROM_EMAIL", "Tee24 ProShop <notifications@tee24.golf>");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("files a member's reply as received", () => {
    expect(classifyInboundEmail({ from: "pat@example.com", to: ["inbox@notifications.tee24.golf", "info@tee24.golf"] })).toEqual({ kind: "received" });
  });

  it("files mail the front-desk mailbox forwards as received", () => {
    expect(classifyInboundEmail({ from: "Pat Golfer <pat@example.com>", to: ["info@tee24.golf"] })).toEqual({ kind: "received" });
  });

  it("files a copy of what staff sent to a customer as sent to that customer", () => {
    expect(classifyInboundEmail({ from: "info@tee24.golf", to: ["pat@example.com"] })).toEqual({ kind: "staff-sent", recipient: "pat@example.com" });
    expect(classifyInboundEmail({ from: "Rob <rob@tee24.golf>", to: ["info@tee24.golf"], cc: ["Pat <Pat@Example.com>", "inbox@notifications.tee24.golf"] })).toEqual({ kind: "staff-sent", recipient: "pat@example.com" });
  });

  it("skips the app's own emails when the mailbox forwards them back", () => {
    expect(classifyInboundEmail({ from: "notifications@tee24.golf", to: ["info@tee24.golf"] })).toEqual({ kind: "own" });
    expect(classifyInboundEmail({ from: "proshop@notifications.tee24.golf", to: ["pat@example.com"] })).toEqual({ kind: "own" });
  });

  it("skips staff-to-staff mail that only arrived through a forward", () => {
    expect(classifyInboundEmail({ from: "rob@tee24.golf", to: ["info@tee24.golf"] })).toEqual({ kind: "internal" });
  });

  it("keeps mail a staff member writes straight to the inbox address", () => {
    expect(classifyInboundEmail({ from: "rob@tee24.golf", to: ["inbox@notifications.tee24.golf", "info@tee24.golf"] })).toEqual({ kind: "received" });
  });
});
