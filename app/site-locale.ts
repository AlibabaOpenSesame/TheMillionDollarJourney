// Single source of truth for which URL paths are English vs Chinese.
// Used by proxy.ts (SSR <html lang>) and HtmlLangSync (client-side navigations).
export type HtmlLang = "zh-CN" | "en";

/** Request header set by proxy.ts so the root layout can render the right <html lang>. */
export const SITE_LANG_HEADER = "x-site-lang";

export function isEnglishPath(pathname: string): boolean {
  return pathname === "/en" || pathname.startsWith("/en/");
}

export function htmlLangForPath(pathname: string): HtmlLang {
  return isEnglishPath(pathname) ? "en" : "zh-CN";
}

export function normalizeHtmlLang(value: string | null | undefined): HtmlLang {
  return value === "en" ? "en" : "zh-CN";
}

/** Share image (static, no account value/date). `v` busts social-card caches after the $1K refresh. */
export const SOCIAL_IMAGE_PATH = "/og.png?v=1.6.1";
