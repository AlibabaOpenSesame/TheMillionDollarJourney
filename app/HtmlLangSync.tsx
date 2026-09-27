"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { htmlLangForPath } from "./site-locale";

// The root layout is shared by `/` and `/en`, so it is not re-rendered on client-side navigation.
// SSR gets the right <html lang> via proxy.ts; this keeps it correct after soft navigations.
export default function HtmlLangSync() {
  const pathname = usePathname();
  useEffect(() => {
    const lang = htmlLangForPath(pathname ?? "/");
    if (document.documentElement.lang !== lang) document.documentElement.lang = lang;
  }, [pathname]);
  return null;
}
