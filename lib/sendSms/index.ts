// lib/sendSms/index.ts
import { sendSms as _sendSms } from "../openphone";

// Derive argument type from the actual function
export type SendSmsArgs = Parameters<typeof _sendSms>[0];

// Re-export under the expected name
export { _sendSms as sendSms };
