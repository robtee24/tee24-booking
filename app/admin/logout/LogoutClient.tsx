// app/admin/logout/LogoutClient.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LogoutClient() {
  const router = useRouter();

  useEffect(() => {
    const logout = async () => {
      await fetch("/api/admin/auth/logout", {
        method: "POST",
        credentials: "include", // sends browser cookies
      });
      router.push("/admin/login");
    };
    logout();
  }, [router]);

  return <div>Logging out...</div>;
}