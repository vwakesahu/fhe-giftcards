import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Site-wide HTTP Basic Auth gate.
 *
 * Set SITE_PASSWORD in the host's env (Vercel / Railway / whatever) to lock
 * the app down to people who know the password. Unset it locally so dev
 * doesn't prompt every refresh. Browser caches credentials per origin for
 * the session, so users see the native auth dialog exactly once.
 *
 * Username is ignored — paste anything in the user field, the password is
 * what's checked. Realm string surfaces in the browser dialog.
 */
const SITE_PASSWORD = process.env.SITE_PASSWORD;

export function middleware(request: NextRequest) {
  if (!SITE_PASSWORD) {
    // No password configured = no gate. Local dev convenience and means a
    // fresh clone of the repo still runs without secrets.
    return NextResponse.next();
  }

  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    const decoded = Buffer.from(auth.slice(6), "base64").toString();
    const pass = decoded.slice(decoded.indexOf(":") + 1);
    if (pass === SITE_PASSWORD) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Sigill (preview)", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}

// Skip static assets so 401s don't block the auth-dialog page from rendering
// its own /_next/static chunks. /favicon.ico is fine to leak.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
