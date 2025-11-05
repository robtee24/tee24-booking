// app/admin/admins/[id]/page.tsx
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { getAdminSession, isRoot } from "@/lib/session";
import Link from "next/link";
import EditAdminForm from "./EditAdminForm";

type Params = { params: { id: string } };

export default async function AdminDetailPage({ params }: Params) {
  const session = await getAdminSession();
  if (!session) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">Admin</h1>
        <p className="mt-2 text-sm text-neutral-600">You are not signed in.</p>
        <a href="/admin/login" className="mt-3 inline-block rounded bg-black px-3 py-2 text-white">
          Go to Login
        </a>
      </div>
    );
  }
  if (!isRoot(session)) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">Admin</h1>
        <div className="mt-4 rounded-xl border bg-white p-5">
          <p className="text-sm text-neutral-700">Forbidden — ROOT access required.</p>
          <div className="mt-3"><Link href="/admin/admins" className="text-sm underline">Back</Link></div>
        </div>
      </div>
    );
  }

  const admin = await prisma.admin.findUnique({
    where: { id: params.id },
    select: {
      id: true, name: true, phone: true, role: true,
      locations: { select: { locationId: true, location: { select: { id: true, name: true } } } },
      createdAt: true, updatedAt: true,
    },
  });
  if (!admin) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">Admin not found</h1>
        <Link href="/admin/admins" className="mt-3 inline-block underline">Back to Admins</Link>
      </div>
    );
  }

  const allLocations = await prisma.location.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const scopedIds = new Set(admin.locations.map(l => l.locationId));

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Manage Admin</h1>
        <Link href="/admin/admins" className="text-sm underline">Back to Admins</Link>
      </div>

      <div className="rounded-2xl border bg-white p-4">
        <div className="text-sm text-neutral-700">
          <div><span className="font-medium">Phone:</span> <span className="font-mono">{admin.phone}</span></div>
          <div><span className="font-medium">Created:</span> {new Date(admin.createdAt).toLocaleString()}</div>
          <div><span className="font-medium">Updated:</span> {new Date(admin.updatedAt).toLocaleString()}</div>
        </div>
      </div>

      <EditAdminForm
        adminId={admin.id}
        initialName={admin.name ?? ""}
        initialRole={admin.role}
        allLocations={allLocations}
        initialLocationIds={[...scopedIds]}
      />
      <p className="text-xs text-neutral-500">Only ROOT can edit admins.</p>
    </div>
  );
}
