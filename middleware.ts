import { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  console.log('Incoming request URL:', request.url);
  console.log('Pathname:', request.nextUrl.pathname);
  console.log('Full path with query:', request.nextUrl.href);

  return;
}