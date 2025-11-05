export type SendSmsArgs = { to: string[]; from?: string; content: string };

/**
 * TEMP shim to unblock build. Logs and returns ok:true.
 * TODO: replace with real OpenPhone integration.
 */
export async function sendSms(args: SendSmsArgs) {
  console.log("[sendSms noop]", args);
  return { ok: true };
}
