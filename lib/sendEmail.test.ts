import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn<(payload: Record<string, unknown>) => Promise<{ data: { id: string }; error: null }>>();

vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));
vi.mock("@/lib/message-ledger", () => ({ recordOutbound: vi.fn(async () => undefined) }));

async function load() {
  vi.resetModules();
  return import("./sendEmail");
}

describe("sendEmail Reply-To", () => {
  beforeEach(() => {
    send.mockReset();
    send.mockResolvedValue({ data: { id: "em_1" }, error: null });
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("RESEND_FROM", "");
    vi.stubEnv("RESEND_FROM_EMAIL", "Tee24 ProShop <notifications@tee24.golf>");
    vi.stubEnv("COMMS_DRY_RUN", "");
    vi.stubEnv("EMAIL_REPLY_DOMAIN", "");
    vi.stubEnv("EMAIL_REPLY_TO", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("sends replies to info@tee24.golf by default", async () => {
    const { sendEmail } = await load();
    const res = await sendEmail("member@example.com", "Booking confirmed", "<p>See you soon</p>");
    expect(res.ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ from: "Tee24 ProShop <notifications@tee24.golf>", replyTo: ["info@tee24.golf"] });
  });

  it("sends replies to the admin inbox and info@tee24.golf once inbound email is set up", async () => {
    vi.stubEnv("EMAIL_REPLY_DOMAIN", "reply.tee24.golf");
    const { sendEmail } = await load();
    await sendEmail({ to: "member@example.com", subject: "Hi", html: "<p>Hi</p>" });
    expect(send.mock.calls[0][0]).toMatchObject({ replyTo: ["inbox@reply.tee24.golf", "info@tee24.golf"] });
  });

  it("keeps a conversation's thread address and still copies info@tee24.golf", async () => {
    vi.stubEnv("EMAIL_REPLY_DOMAIN", "reply.tee24.golf");
    const { sendEmail } = await load();
    await sendEmail({ to: "member@example.com", subject: "Hi", html: "<p>Hi</p>", replyTo: "reply+conv_1@reply.tee24.golf" });
    expect(send.mock.calls[0][0]).toMatchObject({ replyTo: ["reply+conv_1@reply.tee24.golf", "info@tee24.golf"] });
  });

  it("uses only the caller's address when it is not an inbox address", async () => {
    vi.stubEnv("EMAIL_REPLY_DOMAIN", "reply.tee24.golf");
    const { sendEmail } = await load();
    await sendEmail({ to: "member@example.com", subject: "Hi", html: "<p>Hi</p>", replyTo: "frontdesk@example.com" });
    expect(send.mock.calls[0][0]).toMatchObject({ replyTo: ["frontdesk@example.com"] });
  });

  it("lets EMAIL_REPLY_TO replace the default mailbox", async () => {
    vi.stubEnv("EMAIL_REPLY_TO", "hello@tee24.golf");
    const { sendEmail } = await load();
    await sendEmail({ to: "member@example.com", subject: "Hi", html: "<p>Hi</p>" });
    expect(send.mock.calls[0][0]).toMatchObject({ replyTo: ["hello@tee24.golf"] });
  });
});
