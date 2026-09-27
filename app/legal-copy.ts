import type { PortfolioLocale } from "./portfolio-copy";

export type LegalDocKey = "disclaimer" | "privacy";
export type LegalSection = { id: string; heading: string; body: readonly string[] };
export type LegalDoc = { metaTitle: string; metaDescription: string; kicker: string; title: string; intro: string; sections: readonly LegalSection[] };

type LegalCopy = {
  htmlLang: "zh-CN" | "en";
  homePath: string;
  backHome: string;
  otherLocaleLabel: string;
  otherLocalePath: (doc: LegalDocKey) => string;
  docPath: (doc: LegalDocKey) => string;
  docLinkLabel: Record<LegalDocKey, string>;
  contactLabel: string;
  docs: Record<LegalDocKey, LegalDoc>;
};

// Skeleton pages for /disclaimer, /privacy, /en/disclaimer, /en/privacy.
// Every user-facing string below is draft copy to be replaced by the designer's final text.
export const legalCopy: Record<PortfolioLocale, LegalCopy> = {
  zh: {
    htmlLang: "zh-CN",
    homePath: "/",
    backHome: "← 返回首页",
    otherLocaleLabel: "English",
    otherLocalePath: (doc) => `/en/${doc}`,
    docPath: (doc) => `/${doc}`,
    // COPY: placeholder pending designer final
    docLinkLabel: { disclaimer: "免责声明", privacy: "隐私说明" },
    // COPY: placeholder pending designer final
    contactLabel: "联系：X @languagemodelAI",
    docs: {
      disclaimer: {
        // COPY: placeholder pending designer final
        metaTitle: "免责声明",
        metaDescription: "百万美元之路免责声明：不构成投资建议，非持牌顾问，作者持有所展示仓位，数据可能延迟或有误。",
        kicker: "DISCLAIMER",
        title: "免责声明",
        intro: "本站公开记录一个真实的个人投资账户。浏览前请阅读以下说明。",
        sections: [
          { id: "not-advice", heading: "不构成投资建议", body: ["本站所有内容仅为个人投资记录的公开展示，不构成任何投资建议、要约或招揽。请独立判断，并自行承担投资决策的后果。"] },
          { id: "not-licensed", heading: "非持牌投资顾问", body: ["本人不是持牌投资顾问、经纪人或基金经理，不提供个性化投资建议，也不接受代客理财。"] },
          { id: "conflict-of-interest", heading: "利益冲突披露", body: ["本人持有页面所展示的仓位，并可能随时买入或卖出，不会事先通知。"] },
          { id: "data", heading: "数据来源与准确性", body: ["账户数据来自 IBKR 日终报表并自动同步，可能存在延迟、遗漏或错误，一切以券商正式结单为准。"] },
          { id: "past-performance", heading: "过往表现不代表未来", body: ["过往收益不代表未来表现。投资有风险，可能损失全部本金；本账户持仓高度集中，波动可能很大。"] },
        ],
      },
      privacy: {
        // COPY: placeholder pending designer final
        metaTitle: "隐私说明",
        metaDescription: "百万美元之路隐私说明：无账户体系、站点代码不设置跟踪 Cookie，托管于 Cloudflare。",
        kicker: "PRIVACY",
        title: "隐私说明",
        intro: "本站是一个只读的公开展示页面，不要求你提供任何个人信息。",
        sections: [
          { id: "no-accounts", heading: "无账户、无跟踪 Cookie", body: ["本站没有注册或登录功能。站点自身代码不设置用于跟踪的 Cookie，也不在浏览器本地存储中记录访客信息。"] },
          { id: "cloudflare", heading: "Cloudflare 基础设施与访问统计", body: ["本站托管在 Cloudflare 上。为提供服务和安全防护，Cloudflare 会处理访问请求所需的技术信息（例如 IP 地址、浏览器类型、访问时间），并可能记录基础设施日志、提供汇总访问统计（Cloudflare Web Analytics）；Cloudflare 也可能出于安全目的设置必要的 Cookie。"] },
          { id: "contact", heading: "联系方式", body: ["如对隐私有任何疑问，请通过 X（@languagemodelAI）联系。"] },
        ],
      },
    },
  },
  en: {
    htmlLang: "en",
    homePath: "/en",
    backHome: "← Back to home",
    otherLocaleLabel: "中文",
    otherLocalePath: (doc) => `/${doc}`,
    docPath: (doc) => `/en/${doc}`,
    // COPY: placeholder pending designer final
    docLinkLabel: { disclaimer: "Disclaimer", privacy: "Privacy" },
    // COPY: placeholder pending designer final
    contactLabel: "Contact: X @languagemodelAI",
    docs: {
      disclaimer: {
        // COPY: placeholder pending designer final
        metaTitle: "Disclaimer",
        metaDescription: "Disclaimer for The Million Dollar Journey: not investment advice, not a licensed advisor, the author holds the positions shown, data may lag or contain errors.",
        kicker: "DISCLAIMER",
        title: "Disclaimer",
        intro: "This site publishes a real, personal brokerage account. Please read the notes below.",
        sections: [
          { id: "not-advice", heading: "Not investment advice", body: ["Everything on this site is a public record of one person's investing. It is not investment advice, an offer, or a solicitation. Make your own decisions and own their outcomes."] },
          { id: "not-licensed", heading: "Not a licensed advisor", body: ["I am not a licensed investment advisor, broker, or fund manager. I don't give personalized advice and I don't manage money for anyone."] },
          { id: "conflict-of-interest", heading: "Conflict of interest", body: ["I hold the positions shown on this site and may buy or sell them at any time without notice."] },
          { id: "data", heading: "Data source and accuracy", body: ["Account data comes from IBKR end-of-day reports via an automated sync. It may lag, be incomplete, or contain errors; the broker's official statements prevail."] },
          { id: "past-performance", heading: "Past performance", body: ["Past performance does not guarantee future results. Investing involves risk, including the loss of all capital. This account is highly concentrated and can be very volatile."] },
        ],
      },
      privacy: {
        // COPY: placeholder pending designer final
        metaTitle: "Privacy",
        metaDescription: "Privacy notes for The Million Dollar Journey: no accounts, no tracking cookies set by the site's own code, hosted on Cloudflare.",
        kicker: "PRIVACY",
        title: "Privacy",
        intro: "This is a read-only public page. It doesn't ask you for any personal information.",
        sections: [
          { id: "no-accounts", heading: "No accounts, no tracking cookies", body: ["There is no sign-up or login. The site's own code does not set tracking cookies or store visitor information in your browser's local storage."] },
          { id: "cloudflare", heading: "Cloudflare infrastructure and analytics", body: ["The site runs on Cloudflare. To deliver and protect it, Cloudflare processes the technical data every request carries (such as IP address, browser type, and time of visit), and may keep infrastructure logs and provide aggregate visit statistics (Cloudflare Web Analytics). Cloudflare may also set strictly necessary security cookies."] },
          { id: "contact", heading: "Contact", body: ["Questions about privacy? Reach me on X at @languagemodelAI."] },
        ],
      },
    },
  },
};
