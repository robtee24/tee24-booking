// app/admin/login/page.tsx
"use client";

import OtpFlow from "@/components/OtpFlow";

export default function AdminLoginPage() {
  return (
    <div className="grid min-h-dvh place-items-center bg-apple-bg px-4">
      <div className="text-center">
        <div className="mx-auto mb-8 flex h-14 w-14 items-center justify-center rounded-apple bg-apple-blue/10">
          <svg className="h-7 w-7 text-apple-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
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
    </div>
  );
}
