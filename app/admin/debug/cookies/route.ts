import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const raw = request.headers.get("cookie") || "";
  const list = raw.split(";")
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      const i = s.indexOf("=");
      const name = i === -1 ? s : s.slice(0, i);
      const preview = i === -1 ? "" : s.slice(i + 1, i + 1 + 8);
      return { name, valuePreview: preview ? `${preview}…` : "" };
    });

  return NextResponse.json({
    ok: true,
    count: list.length,
    cookies: list,
  });
}