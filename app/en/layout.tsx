import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/icon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
    shortcut: ["/favicon.ico"],
  },
  title: "The Million Dollar Journey | Ding Xiaoshan U.S. Public Equity Portfolio",
  description: "From $10,000 to $1,000,000: a public investment journey tracking performance, milestones, holdings, and P&L.",
  openGraph: {
    title: "The Million Dollar Journey",
    description: "$10K → $1M · One Portfolio. One Journey.",
  },
  twitter: {
    card: "summary_large_image",
    title: "The Million Dollar Journey",
    description: "$10K → $1M · One Portfolio. One Journey.",
  },
};

export default function EnglishLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
