// services/admin-auth.service.ts

import { getPrisma } from "@/lib/db";
import {
  clearPending2faSession,
  getPending2faSession,
  setAdminSession,
  setPending2faSession,
} from "@/lib/session.server";
import { otpService } from "@/services/otp.service";
import { ENV } from "@/lib/env";
import { verifyCode as verifyTotp } from "@/lib/totp";
import { audit } from "@/lib/audit";

/**
 * Custom error type that carries HTTP status — perfect for route handlers just catch it
 */
class AdminAuthError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "AdminAuthError";
  }
}

export type LoginResult =
  | { ok: true; requires2fa: false }
  | { ok: true; requires2fa: true };

export class AdminAuthService {
  /**
   * Step 1 of admin login:
   *   • Verify OTP
   *   • Find or bootstrap admin account
   *   • If 2FA is enabled → issue a 5-minute pending cookie and return
   *     `{ requires2fa: true }` (NO session yet)
   *   • Otherwise → create the full session
   *
   * Throws AdminAuthError on any failure (route catches and returns correct status)
   */
  async loginWithOtp(rawPhone: string, code: string | number): Promise<LoginResult> {
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
      select: { id: true, role: true, twoFactorEnabled: true, twoFactorSecret: true },
    });

    // 4. ROOT bootstrap (first-time setup only)
    if (
      !admin &&
      ENV.ROOT_ADMIN_PHONE &&
      phone === otpService.normalize(ENV.ROOT_ADMIN_PHONE)
    ) {
      admin = await getPrisma().admin.create({
        data: { phone, role: "ROOT" },
        select: { id: true, role: true, twoFactorEnabled: true, twoFactorSecret: true },
      });
    }

    // 5. Final authorization check
    if (!admin) {
      throw new AdminAuthError("Not authorized as admin", 403);
    }

    // 6. 2FA gate — park in the pending state instead of issuing the session
    if (admin.twoFactorEnabled && admin.twoFactorSecret) {
      await setPending2faSession(admin.id);
      return { ok: true, requires2fa: true };
    }

    // 7. Create session
    await this.finalizeLogin(admin.id, admin.role, "otp");
    return { ok: true, requires2fa: false };
  }

  /**
   * Step 2 of admin login (only for admins with 2FA enabled): consume the
   * pending cookie + verify the TOTP code, then issue the real session.
   */
  async completeTwoFactorLogin(totpCode: string): Promise<{ ok: true }> {
    const pending = await getPending2faSession();
    if (!pending) {
      throw new AdminAuthError("Your sign-in session expired. Please start over.", 410);
    }
    const code = String(totpCode ?? "").replace(/\D/g, "");
    if (code.length !== 6) throw new AdminAuthError("Code must be 6 digits", 400);

    const admin = await getPrisma().admin.findUnique({
      where: { id: pending.adminId },
      select: { id: true, role: true, twoFactorEnabled: true, twoFactorSecret: true },
    });
    if (!admin) throw new AdminAuthError("Not authorized as admin", 403);

    // 2FA was turned off between steps → the OTP alone is sufficient.
    if (admin.twoFactorEnabled && admin.twoFactorSecret) {
      if (!verifyTotp(admin.twoFactorSecret, code)) {
        throw new AdminAuthError("Invalid authenticator code", 401);
      }
    }

    await clearPending2faSession();
    await this.finalizeLogin(admin.id, admin.role, "otp+totp");
    return { ok: true };
  }

  /** Whether the current request carries a valid 2FA-pending cookie. */
  async hasPendingTwoFactor(): Promise<boolean> {
    return !!(await getPending2faSession());
  }

  /** Issue the session, stamp lastLoginAt, flip INVITED → ACTIVE, audit. */
  private async finalizeLogin(adminId: string, role: "ROOT" | "FULL" | "SCOPED", method: string) {
    await setAdminSession(adminId, role);
    try {
      await getPrisma().admin.update({
        where: { id: adminId },
        data: { lastLoginAt: new Date(), inviteStatus: "ACTIVE" },
      });
    } catch (e) {
      console.error("[admin-auth] failed to stamp login", e);
    }
    void audit({
      actorId: adminId,
      actorRole: role,
      action: "admin.login",
      entityType: "Admin",
      entityId: adminId,
      metadata: { method },
    });
  }
}

// Singleton export — used by API routes
export const adminAuthService = new AdminAuthService();
