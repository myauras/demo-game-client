import type { Metadata } from "next";
import { assetPath } from "./lib/assets";
import "./globals.css";

const siteOrigin = process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "http://localhost:3000";
const title = "Arena — 冠軍預測亂鬥";
const description = "選擇你看好的英雄，觀看五人亂鬥，預測冠軍並贏得模擬獎金。";
const socialImage = `${siteOrigin}${assetPath("/og-v2.png")}`;

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title,
  description,
  icons: { icon: assetPath("/favicon.png"), shortcut: assetPath("/favicon.png") },
  openGraph: {
    title,
    description,
    images: [{ url: socialImage, width: 1536, height: 1024, alt: "Arena 冠軍預測亂鬥" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [socialImage],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
