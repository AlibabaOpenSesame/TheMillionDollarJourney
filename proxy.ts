import { NextResponse, type NextRequest } from "next/server";
import { SITE_LANG_HEADER, htmlLangForPath } from "./app/site-locale";

// Tells the root layout which <html lang> to server-render: `/en` and `/en/*` → "en", everything else → "zh-CN".
// Any client-supplied value of the header is overwritten here.
export function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(SITE_LANG_HEADER, htmlLangForPath(request.nextUrl.pathname));
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Pages only: skip API routes, framework internals, and static files (anything with an extension).
  matcher: ["/((?!api/|_vinext/|_next/|.*\\.[\\w]+$).*)"],
};
