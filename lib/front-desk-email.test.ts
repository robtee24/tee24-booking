import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyInboundEmail } from "./inbound-email";

const send = vi.fn<(payload: Record<string, unknown>) => Promise<{ data: { id: string } | null; error: { message: string } | null }>>();
const recordOutbound = vi.fn(async () => undefined);

vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));
vi.mock("@/lib/message-ledger", () => ({ recordOutbound }));

async function load() {
  vi.resetModules();
  return import("./front-desk-email");
}

const member = { firstName: "Pat", lastName: "Golfer", email: "Pat@Example.com", phone: "+15025550100", locationName: "Tee24 Louisville" };

describe("front-desk copy of a member's portal message", () => {
  beforeEach(() => {
    send.mockReset();
    send.mockResolvedValue({ data: { id: "em_1" }, error: null });
    recordOutbound.mockClear();
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("RESEND_FROM", "");
    vi.stubEnv("RESEND_FROM_EMAIL", "Tee24 ProShop <notifications@tee24.golf>");
    vi.stubEnv("COMMS_DRY_RUN", "");
    vi.stubEnv("EMAIL_REPLY_DOMAIN", "notifications.tee24.golf");
    vi.stubEnv("EMAIL_REPLY_TO", "");
    vi.stubEnv("APP_BASE_URL", "https://reservations.tee24.golf/");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("goes to info@tee24.golf, with replies going to the member only", async () => {
    const { emailFrontDeskMemberMessage } = await load();
    const res = await emailFrontDeskMemberMessage({ member, subject: "Door access not working", topic: "door_issue", body: "The door\nwon't open.", replyBy: "EMAIL" });
    expect(res).toMatchObject({ ok: true, to: "info@tee24.golf" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({
      from: "Tee24 ProShop <notifications@tee24.golf>",
      to: "info@tee24.golf",
      replyTo: ["Pat@Example.com"],
      subject: "Member message: Door access not working — Pat Golfer",
    });
  });

  it("is not logged as a second message (the member's message is already on their thread)", async () => {
    const { emailFrontDeskMemberMessage } = await load();
    await emailFrontDeskMemberMessage({ member, subject: "Hi", body: "Hello", replyBy: "EMAIL" });
    expect(recordOutbound).not.toHaveBeenCalled();
  });

  it("uses the EMAIL_REPLY_TO mailbox when one is set", async () => {
    vi.stubEnv("EMAIL_REPLY_TO", "frontdesk@tee24.golf");
    const { emailFrontDeskMemberMessage } = await load();
    const res = await emailFrontDeskMemberMessage({ member, subject: "Hi", body: "Hello", replyBy: "EMAIL" });
    expect(res.to).toBe("frontdesk@tee24.golf");
    expect(send.mock.calls[0][0]).toMatchObject({ to: "frontdesk@tee24.golf" });
  });

  it("keeps replies in the mailbox when the member has no email on file", async () => {
    const { emailFrontDeskMemberMessage } = await load();
    await emailFrontDeskMemberMessage({ member: { ...member, email: null }, subject: "Hi", body: "Hello", replyBy: "SMS" });
    expect(send.mock.calls[0][0]).toMatchObject({ replyTo: ["info@tee24.golf"] });
    expect(String(send.mock.calls[0][0].html)).toContain("no email on file");
  });

  it("reports a failed send instead of throwing", async () => {
    send.mockResolvedValue({ data: null, error: { message: "The tee24.golf domain is not verified" } });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const { emailFrontDeskMemberMessage } = await load();
    await expect(emailFrontDeskMemberMessage({ member, subject: "Hi", body: "Hello", replyBy: "EMAIL" })).resolves.toMatchObject({ ok: false, error: "The tee24.golf domain is not verified" });
    send.mockRejectedValue(new Error("network down"));
    await expect(emailFrontDeskMemberMessage({ member, subject: "Hi", body: "Hello", replyBy: "EMAIL" })).resolves.toMatchObject({ ok: false });
    errorLog.mockRestore();
  });

  it("shows who wrote, what they wrote and where to find it, with the member's text escaped", async () => {
    const { buildMemberMessageCopy } = await load();
    const { subject, html } = buildMemberMessageCopy({
      member,
      subject: "  Refund\nplease ",
      topic: "request_refund",
      body: "<script>alert(1)</script>\nSecond line & more",
      replyBy: "SMS",
      conversationPath: "/admin/locations/louisville/marketing/inbox?c=conv_1",
      profilePath: "/admin/locations/louisville/members/list/mem_1/messaging",
    });
    expect(subject).toBe("Member message: Refund please — Pat Golfer");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;<br>Second line &amp; more");
    expect(html).toContain("Pat Golfer");
    expect(html).toContain("mailto:Pat@Example.com");
    expect(html).toContain("Tee24 Louisville");
    expect(html).toContain("Request a refund");
    expect(html).toContain(">Text<");
    expect(html).toContain('href="https://reservations.tee24.golf/admin/locations/louisville/marketing/inbox?c=conv_1"');
    expect(html).toContain('href="https://reservations.tee24.golf/admin/locations/louisville/members/list/mem_1/messaging"');
  });

  it("falls back to a plain subject when the member left it blank", async () => {
    const { buildMemberMessageCopy } = await load();
    expect(buildMemberMessageCopy({ member, subject: " ", topic: "general", body: "Hello", replyBy: "EMAIL" }).subject).toBe("Member message from Pat Golfer");
  });

  it("is skipped, not filed again, when the mailbox forwards it to the admin inbox", () => {
    // Shape Resend actually sends for a forwarded copy: `to` is the inbound address, the mailbox is in `received_for`.
    expect(classifyInboundEmail({ from: "Tee24 ProShop <notifications@tee24.golf>", to: ["inbox@notifications.tee24.golf"], cc: [] })).toEqual({ kind: "own" });
  });
});
