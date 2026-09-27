import type { Metadata } from "next";
import Link from "next/link";
import type { PortfolioLocale } from "./portfolio-copy";
import { legalCopy, type LegalDocKey } from "./legal-copy";

export function legalMetadata(locale: PortfolioLocale, doc: LegalDocKey): Metadata {
  const { metaTitle, metaDescription } = legalCopy[locale].docs[doc];
  return { title: metaTitle, description: metaDescription };
}

export default function LegalPage({ locale, doc }: { locale: PortfolioLocale; doc: LegalDocKey }) {
  const copy = legalCopy[locale];
  const page = copy.docs[doc];
  const otherDoc: LegalDocKey = doc === "disclaimer" ? "privacy" : "disclaimer";
  return (
    <main className="legal-page" lang={copy.htmlLang}>
      <div className="legal-shell">
        <nav className="legal-nav">
          <Link href={copy.homePath}>{copy.backHome}</Link>
          <Link href={copy.otherLocalePath(doc)} hrefLang={locale === "zh" ? "en" : "zh-CN"}>{copy.otherLocaleLabel}</Link>
        </nav>
        <header className="legal-header">
          <span className="legal-kicker">{page.kicker}</span>
          <h1>{page.title}</h1>
          <p className="legal-updated">{page.updated}</p>
          <p className="legal-intro">{page.intro}</p>
        </header>
        {page.sections.map((section) => (
          <section className="legal-section" id={section.id} key={section.id} aria-labelledby={`${section.id}-heading`}>
            <h2 id={`${section.id}-heading`}>{section.heading}</h2>
            {section.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </section>
        ))}
        <footer className="legal-footer">
          <Link href={copy.docPath(otherDoc)}>{copy.docLinkLabel[otherDoc]}</Link>
          <a href="https://x.com/idingxs" target="_blank" rel="noreferrer">{copy.contactLabel}</a>
        </footer>
      </div>
    </main>
  );
}
