// app/api/ping/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ 
    message: 'Serverless function running!',
    time: new Date().toISOString()
  });
}