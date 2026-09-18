import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  // Preserve the existing approved cover without trusting forwarded host headers.
  const socialImage = "https://openinvestai.com/og.png";

  return {
    title: {
      default: "OpenInvest AI v2.0｜百万美元之路",
      template: "%s｜OpenInvest AI v2.0",
    },
    description: "公开、可验证的投资旅程：IBKR 已核验净值、独立行情估算、持仓、活动记录与每日 Session。",
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "48x48" },
        { url: "/icon-light-32.png", type: "image/png", sizes: "32x32", media: "(prefers-color-scheme: light)" },
        { url: "/icon-dark-32.png", type: "image/png", sizes: "32x32", media: "(prefers-color-scheme: dark)" },
        { url: "/icon-light-192.png", type: "image/png", sizes: "192x192", media: "(prefers-color-scheme: light)" },
        { url: "/icon-dark-192.png", type: "image/png", sizes: "192x192", media: "(prefers-color-scheme: dark)" },
        { url: "/icon-32.png", type: "image/png", sizes: "32x32" },
        { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      ],
      apple: [
        { url: "/apple-touch-icon-light.png", sizes: "180x180", media: "(prefers-color-scheme: light)" },
        { url: "/apple-touch-icon-dark.png", sizes: "180x180", media: "(prefers-color-scheme: dark)" },
        { url: "/apple-touch-icon.png", sizes: "180x180" },
      ],
      shortcut: ["/favicon.ico"],
    },
    openGraph: {
      title: "百万美元之路｜The Million Dollar Journey",
      description: "$1K → $1M · One Portfolio. One Journey.",
      type: "website",
      images: [{ url: socialImage, width: 1200, height: 630, alt: "百万美元之路：从 $1K 到 $1M" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "百万美元之路｜The Million Dollar Journey",
      description: "$1K → $1M · One Portfolio. One Journey.",
      images: [socialImage],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
