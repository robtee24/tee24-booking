// services/admin-auth.service.ts

import { getPrisma } from "@/lib/db";
import { setAdminSession } from "@/lib/session.server";
import { otpService } from "@/services/otp.service";
import { ENV } from "@/lib/env";

/**
 * Custom error type that carries HTTP status — perfect for route handlers just catch it
 */
class AdminAuthError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "AdminAuthError";
  }
}

export class AdminAuthService {
  /**
   * Complete admin login flow:
   *   • Verify OTP
   *   • Find or bootstrap admin account
   *   • Create session
   *
   * Throws AdminAuthError on any failure (route catches and returns correct status)
   */
  async loginWithOtp(rawPhone: string, code: string | number) {
    // 1. Verify OTP
    const verifyResult = await otpService.verifyOtp(rawPhone, code);

    if (!verifyResult.ok) {
      const message =
        verifyResult.reason === "EXPIRED"
          ? "Code has expired"
          : verifyResult.reason === "INVALID_FORMAT"
          ? "Code must be 6 digits"
          : "Invalid code";

      throw new AdminAuthError(message, verifyResult.reason === "EXPIRED" ? 410 : 401);
    }

    // 2. Normalize phone exactly once — using public method
    const phone = otpService.normalize(rawPhone);

    // 3. Find existing admin
    let admin = await getPrisma().admin.findUnique({
      where: { phone },
      select: { id: true, role: true },
    });

    // 4. ROOT bootstrap (first-time setup only)
    if (
      !admin &&
      ENV.ROOT_ADMIN_PHONE &&
      phone === otpService.normalize(ENV.ROOT_ADMIN_PHONE)
    ) {
      admin = await getPrisma().admin.create({
        data: { phone, role: "ROOT" },
        select: { id: true, role: true },
      });
    }

    // 5. Final authorization check
    if (!admin) {
      throw new AdminAuthError("Not authorized as admin", 403);
    }

    // 6. Create session
    await setAdminSession(admin.id, admin.role);

    return { ok: true };
  }
}

// Singleton export — used by API routes
export const adminAuthService = new AdminAuthService();