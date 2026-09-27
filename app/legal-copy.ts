import type { PortfolioLocale } from "./portfolio-copy";

export type LegalDocKey = "disclaimer" | "privacy";
export type LegalSection = { id: string; heading: string; body: readonly string[] };
export type LegalDoc = { metaTitle: string; metaDescription: string; kicker: string; title: string; updated: string; intro: string; sections: readonly LegalSection[] };

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

// Final copy for /disclaimer, /privacy, /en/disclaimer, /en/privacy.
export const legalCopy: Record<PortfolioLocale, LegalCopy> = {
  zh: {
    htmlLang: "zh-CN",
    homePath: "/",
    backHome: "← 返回首页",
    otherLocaleLabel: "English",
    otherLocalePath: (doc) => `/en/${doc}`,
    docPath: (doc) => `/${doc}`,
    docLinkLabel: { disclaimer: "免责声明", privacy: "隐私说明" },
    contactLabel: "联系：X @idingxs",
    docs: {
      disclaimer: {
        metaTitle: "免责声明",
        metaDescription: "百万美元之路免责声明：不构成投资建议，非持牌顾问，作者持有所展示仓位，数据可能延迟或有误。",
        kicker: "DISCLAIMER",
        title: "免责声明",
        updated: "更新于 2026-09-27",
        intro: "本站公开记录一个真实的个人投资账户。浏览前请阅读以下说明。",
        sections: [
          { id: "not-advice", heading: "不构成投资建议", body: ["本站所有内容仅为个人投资记录的公开展示，不构成任何投资建议、要约或招揽。请独立判断，并自行承担投资决策的后果。"] },
          { id: "not-licensed", heading: "非持牌投资顾问", body: ["本人不是持牌投资顾问、经纪人或基金经理，不提供个性化投资建议，也不接受代客理财。"] },
          { id: "no-paid-service", heading: "不收费、不卖任何东西", body: ["本站免费，不销售课程、会员、信号或任何付费服务，也不接受任何形式的委托。"] },
          { id: "no-endorsement", heading: "与券商无关联", body: ["IBKR 只是我开户的券商，与本站没有合作、赞助或背书关系。页面上的「IBKR」字样仅说明数据来源。"] },
          { id: "conflict-of-interest", heading: "利益冲突披露", body: ["本人持有页面所展示的仓位，并可能随时买入或卖出，不会事先通知。"] },
          { id: "data", heading: "数据来源与准确性", body: ["账户数据来自 IBKR 日终报表并自动同步，可能存在延迟、遗漏或错误，一切以券商正式结单为准。", "页面是日终快照，不是实时行情；行情组件由第三方提供，可能延迟；人民币金额按汇率估算，仅供参考。"] },
          { id: "past-performance", heading: "过往表现不代表未来", body: ["过往收益不代表未来表现。投资有风险，可能损失全部本金；本账户持仓高度集中，波动可能很大。"] },
        ],
      },
      privacy: {
        metaTitle: "隐私说明",
        metaDescription: "百万美元之路隐私说明：无账户体系、站点代码不设置跟踪 Cookie，托管于 Cloudflare。",
        kicker: "PRIVACY",
        title: "隐私说明",
        updated: "更新于 2026-09-27",
        intro: "本站是一个只读的公开展示页面，不要求你提供任何个人信息。",
        sections: [
          { id: "no-accounts", heading: "无账户，站点自身不设跟踪 Cookie", body: ["本站没有注册或登录功能。站点自身代码不设置用于跟踪的 Cookie，也不在浏览器本地存储中记录访客信息。"] },
          { id: "cloudflare", heading: "Cloudflare 基础设施与访问统计", body: ["本站托管在 Cloudflare 上。为提供服务和安全防护，Cloudflare 会处理访问请求所需的技术信息（例如 IP 地址、浏览器类型、访问时间），并可能记录基础设施日志、提供汇总访问统计（Cloudflare Web Analytics）；Cloudflare 也可能出于安全目的设置必要的 Cookie。"] },
          { id: "third-party", heading: "第三方组件", body: ["页面嵌入了 TradingView 行情组件，加载时会直接连接 TradingView 的服务器，对方可能按其自己的政策设置 Cookie。本站外链（如 X）适用各自平台的隐私政策。"] },
          { id: "contact", heading: "联系方式", body: ["如对隐私有任何疑问，请通过 X（@idingxs）联系。"] },
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
    docLinkLabel: { disclaimer: "Disclaimer", privacy: "Privacy" },
    contactLabel: "Contact: X @idingxs",
    docs: {
      disclaimer: {
        metaTitle: "Disclaimer",
        metaDescription: "Disclaimer for The Million Dollar Journey: not investment advice, not a licensed advisor, the author holds the positions shown, data may lag or contain errors.",
        kicker: "DISCLAIMER",
        title: "Disclaimer",
        updated: "Last updated Sep 27, 2026",
        intro: "This site publishes a real, personal brokerage account. Please read the notes below.",
        sections: [
          { id: "not-advice", heading: "Not investment advice", body: ["Everything on this site is a public record of one person's investing. It is not investment advice, an offer, or a solicitation. Make your own decisions and own their outcomes."] },
          { id: "not-licensed", heading: "Not a licensed advisor", body: ["I am not a licensed investment advisor, broker, or fund manager. I don't give personalized advice and I don't manage money for anyone."] },
          { id: "no-paid-service", heading: "Free, nothing for sale", body: ["This site is free. I don't sell courses, memberships, signals, or any paid service, and I don't accept money to manage."] },
          { id: "no-endorsement", heading: "No broker affiliation", body: ["IBKR is simply where my account is held. It does not sponsor, partner with, or endorse this site; \"IBKR\" here only names the data source."] },
          { id: "conflict-of-interest", heading: "Conflict of interest", body: ["I hold the positions shown on this site and may buy or sell them at any time without notice."] },
          { id: "data", heading: "Data source and accuracy", body: ["Account data comes from IBKR end-of-day reports via an automated sync. It may lag, be incomplete, or contain errors; the broker's official statements prevail.", "Pages show end-of-day snapshots, not live prices. Quote widgets come from a third party and may be delayed. CNY amounts are estimates at the displayed rate."] },
          { id: "past-performance", heading: "Past performance", body: ["Past performance does not guarantee future results. Investing involves risk, including the loss of all capital. This account is highly concentrated and can be very volatile."] },
        ],
      },
      privacy: {
        metaTitle: "Privacy",
        metaDescription: "Privacy notes for The Million Dollar Journey: no accounts, no tracking cookies set by the site's own code, hosted on Cloudflare.",
        kicker: "PRIVACY",
        title: "Privacy",
        updated: "Last updated Sep 27, 2026",
        intro: "This is a read-only public page. It doesn't ask you for any personal information.",
        sections: [
          { id: "no-accounts", heading: "No accounts, no tracking cookies from the site's own code", body: ["There is no sign-up or login. The site's own code does not set tracking cookies or store visitor information in your browser's local storage."] },
          { id: "cloudflare", heading: "Cloudflare infrastructure and analytics", body: ["The site runs on Cloudflare. To deliver and protect it, Cloudflare processes the technical data every request carries (such as IP address, browser type, and time of visit), and may keep infrastructure logs and provide aggregate visit statistics (Cloudflare Web Analytics). Cloudflare may also set strictly necessary security cookies."] },
          { id: "third-party", heading: "Third-party widgets", body: ["Pages embed TradingView quote widgets, which connect directly to TradingView's servers and may set cookies under their own policy. External links such as X follow their own privacy policies."] },
          { id: "contact", heading: "Contact", body: ["Questions about privacy? Reach me on X at @idingxs."] },
        ],
      },
    },
  },
};
