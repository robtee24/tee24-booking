// app/api/debug/env/route.ts
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    NODE_ENV: process.env.NODE_ENV ?? null,
    HAS_CRON_SECRET: Boolean(process.env.CRON_SECRET),
    CRON_SECRET: process.env.CRON_SECRET || '(not loaded)',
  });
}
