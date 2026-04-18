import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy (Next.js 16 replacement for `middleware.ts`) gating /api/rpc:
 *   1. Same-origin guard — reject cross-site callers by comparing `origin`
 *      and `referer` to our host. Wallets proxy server-side anyway.
 *   2. Rate limit — 60 req/min per IP, in-memory (good enough for one
 *      process; swap for Upstash / KV if you run multiple).
 *
 * Anything else on the site passes through untouched.
 */

const WINDOW_MS = 60_000;
const LIMIT = 60;

type Counter = { count: number; resetAt: number };
const buckets = new Map<string, Counter>();

function rateLimit(ip: string): { ok: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now > b.resetAt) {
    const next = { count: 1, resetAt: now + WINDOW_MS };
    buckets.set(ip, next);
    return { ok: true, remaining: LIMIT - 1, resetAt: next.resetAt };
  }
  b.count += 1;
  return { ok: b.count <= LIMIT, remaining: Math.max(0, LIMIT - b.count), resetAt: b.resetAt };
}

function getIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() ?? "unknown";
  return req.headers.get("x-real-ip") ?? "unknown";
}

export function proxy(req: NextRequest) {
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const host = req.headers.get("host");

  // Same-origin check. Wallet connectors proxy through the server already,
  // so legitimate traffic always has a matching origin/referer.
  const sameOrigin =
    !origin ||
    new URL(origin).host === host ||
    (referer && new URL(referer).host === host);
  if (!sameOrigin) {
    return NextResponse.json({ error: "cross-site blocked" }, { status: 403 });
  }

  const ip = getIp(req);
  const { ok, remaining, resetAt } = rateLimit(ip);
  if (!ok) {
    return NextResponse.json(
      { error: "rate limit exceeded" },
      {
        status: 429,
        headers: {
          "X-RateLimit-Limit": String(LIMIT),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
          "Retry-After": String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))),
        },
      },
    );
  }

  const res = NextResponse.next();
  res.headers.set("X-RateLimit-Limit", String(LIMIT));
  res.headers.set("X-RateLimit-Remaining", String(remaining));
  res.headers.set("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));
  return res;
}

export const config = {
  // Match the RPC endpoint itself and any future subroutes underneath it.
  matcher: ["/api/rpc", "/api/rpc/:path*"],
};
