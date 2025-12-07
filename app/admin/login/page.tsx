// app/admin/login/page.tsx

"use client";

import OtpFlow from "@/components/OtpFlow";

export default function AdminLoginPage() {
  return (
    <div className="grid min-h-dvh place-items-center bg-neutral-50 px-4">
      <OtpFlow
        title="Tee24 Admin Login"
        subtitle="Enter your phone to receive a one-time code"
        startEndpoint="/api/admin/auth/start"
        verifyEndpoint="/api/admin/auth/verify"
        onSuccess={() => {
          window.location.href = "/admin";
        }}
      />
    </div>
  );
}