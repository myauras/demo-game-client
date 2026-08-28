import type { Metadata } from "next";
import { assetPath } from "./lib/assets";
import "./globals.css";

const siteOrigin = process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "http://localhost:3000";
const title = "Arena — 五人亂鬥競猜";
const description = "選擇獨贏、位置、連贏、位置Q或二重彩，觀看五人亂鬥並結算模擬獎金。";
const socialImage = `${siteOrigin}${assetPath("/og-v2.png")}`;

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title,
  description,
  icons: { icon: assetPath("/favicon.png"), shortcut: assetPath("/favicon.png") },
  openGraph: {
    title,
    description,
    images: [{ url: socialImage, width: 1536, height: 1024, alt: "Arena 五人亂鬥競猜" }],
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
      <head>
        <link
          rel="preload"
          as="image"
          href={assetPath("/arena-map-v1.webp")}
          type="image/webp"
          fetchPriority="high"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
