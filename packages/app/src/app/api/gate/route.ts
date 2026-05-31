import { NextResponse, type NextRequest } from "next/server";

/**
 * Password-gate cookie issuer. POSTed to by the gate page in proxy.ts.
 *
 * Form field: `password`
 * Optional:   `from` (path to redirect to after auth)
 *
 * On match: sets `sigill-gate` cookie (httpOnly, sameSite=lax, 7-day TTL)
 * and redirects to `from` or `/`.
 *
 * On mismatch: 303-redirects back to /api/gate?error=1&from=<from> so the
 * proxy re-renders the gate page with an inline error.
 */
export async function POST(req: NextRequest) {
  const expected = process.env.SITE_PASSWORD;
  if (!expected) {
    // No password configured = nothing to check. Send the visitor home.
    return NextResponse.redirect(new URL("/", req.url), { status: 303 });
  }

  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const from = String(form.get("from") ?? "/") || "/";
  // Constrain redirect target to same-origin paths only.
  const safeFrom = from.startsWith("/") && !from.startsWith("//") ? from : "/";

  if (password !== expected) {
    const u = new URL(req.url);
    u.pathname = "/";
    u.searchParams.set("__gate", "1");
    u.searchParams.set("__gate_error", "1");
    u.searchParams.set("__gate_from", safeFrom);
    return NextResponse.redirect(u, { status: 303 });
  }

  const res = NextResponse.redirect(new URL(safeFrom, req.url), { status: 303 });
  res.cookies.set("sigill-gate", expected, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
  return res;
}
