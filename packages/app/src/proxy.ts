import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy (Next.js 16 replacement for `middleware.ts`). Runs on every request
 * the matcher catches. Two responsibilities:
 *
 *   1. **Site-wide password gate** (when `SITE_PASSWORD` is set). Renders a
 *      Sigill-branded gate page instead of the browser's native auth
 *      dialog. Auth flow: gate page → POST /api/gate → `sigill-gate`
 *      cookie set → all subsequent requests pass.
 *   2. **`/api/rpc` protection** — same-origin guard + per-IP rate limit
 *      (60 req/min). Anything else on the site passes through after auth.
 *
 * The matcher catches every route except static asset paths so a single
 * password gate protects pages, API routes, and the RPC proxy in one place.
 */

const SITE_PASSWORD = process.env.SITE_PASSWORD;
const GATE_COOKIE = "sigill-gate";

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

/** Sigill-branded gate page rendered when no/wrong cookie. Self-contained
 *  HTML with inline styles so it works without the app's webpack bundle. */
function gatePage(from: string, error: boolean): string {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>Sigill · private preview</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; height: 100%; background: #0d0c0a; color: #f4efe6; font-family: 'Geist', -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
  body { display: grid; place-items: center; padding: 24px; }
  .card { width: 100%; max-width: 380px; }
  .word { font-family: 'Instrument Serif', Georgia, 'Times New Roman', serif; font-style: italic; font-size: 38px; line-height: 1; letter-spacing: -0.01em; }
  .tag { margin-top: 14px; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(244,239,230,0.45); }
  .lede { margin: 20px 0 28px; font-size: 14px; line-height: 1.55; color: rgba(244,239,230,0.7); }
  form { display: flex; flex-direction: column; gap: 10px; }
  label { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(244,239,230,0.5); }
  input { height: 42px; padding: 0 14px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.02); color: #f4efe6; font: inherit; font-size: 14px; outline: none; transition: border-color 0.15s; }
  input:focus { border-color: rgba(125,212,164,0.55); }
  button { margin-top: 6px; height: 42px; border-radius: 999px; border: 0; background: #7dd4a4; color: #0d0c0a; font-weight: 500; font-size: 14px; cursor: pointer; transition: opacity 0.15s; }
  button:hover { opacity: 0.9; }
  .err { margin-top: 12px; font-size: 12px; color: #f08077; }
  .foot { margin-top: 28px; font-size: 11px; color: rgba(244,239,230,0.35); line-height: 1.5; }
  a { color: rgba(244,239,230,0.6); text-decoration: none; border-bottom: 1px solid rgba(244,239,230,0.2); }
  a:hover { color: #f4efe6; }
</style>
</head>
<body>
  <div class="card">
    <div class="word">sigill</div>
    <div class="tag">Private preview</div>
    <p class="lede">Sigill is in a gated preview. Enter the shared password to continue.</p>
    <form method="POST" action="/api/gate" autocomplete="off">
      <label for="pw">Password</label>
      <input id="pw" name="password" type="password" autofocus required />
      <input type="hidden" name="from" value="${escape(from)}" />
      <button type="submit">Continue</button>
      ${error ? '<div class="err">Incorrect password. Try again.</div>' : ""}
    </form>
    <p class="foot">Private gift-card checkout. <a href="https://www.sigill.store">sigill.store</a> for the landing.</p>
  </div>
</body>
</html>`;
}

function passwordGate(req: NextRequest): NextResponse | null {
  if (!SITE_PASSWORD) return null;

  // Let the gate-submission endpoint through so the password form can POST.
  if (req.nextUrl.pathname === "/api/gate") return null;

  const cookie = req.cookies.get(GATE_COOKIE)?.value;
  if (cookie === SITE_PASSWORD) return null;

  // Compose the form's "redirect after auth" target from the current URL.
  // /api/gate's redirect uses ?__gate_error=1&__gate_from=... on a failed
  // attempt; treat that as a gate-page render with an inline error message.
  const url = req.nextUrl;
  const error = url.searchParams.get("__gate_error") === "1";
  const from =
    url.searchParams.get("__gate_from") ??
    (url.pathname === "/" ? "/" : url.pathname + url.search);

  return new NextResponse(gatePage(from, error), {
    status: 401,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function proxy(req: NextRequest) {
  // 1) Password gate runs first so unauthenticated traffic never reaches the
  //    rate-limit bookkeeping (otherwise scrapers could burn the IP budget
  //    just by hitting /api/rpc without creds).
  const gateResponse = passwordGate(req);
  if (gateResponse) return gateResponse;

  // 2) /api/rpc gets the same-origin + rate-limit treatment. Other paths
  //    (pages, static, /api/* outside /api/rpc) pass through.
  if (!req.nextUrl.pathname.startsWith("/api/rpc")) {
    return NextResponse.next();
  }

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
  // Catch every route except static-asset noise. /api/rpc-specific logic
  // gates itself inside the proxy() body, so widening the matcher is safe.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
