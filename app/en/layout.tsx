import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
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
