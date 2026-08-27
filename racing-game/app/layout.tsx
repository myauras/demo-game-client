import type { Metadata } from "next";
import "./globals.css";

const assetBase = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const siteOrigin = process.env.NEXT_PUBLIC_SITE_ORIGIN;

export const metadata: Metadata = {
  metadataBase: siteOrigin ? new URL(siteOrigin) : undefined,
  title: "極速反攻｜決勝圈競速",
  description: "鎖定前車、逐一超越，在保住戰果與挑戰冠軍之間做出選擇的 H5 競速遊戲。",
  openGraph: {
    title: "極速反攻｜決勝圈競速",
    description: "鎖定前車、逐一超越，向最高 10 倍冠軍獎勵發起攻勢。",
    type: "website",
    images: [{ url: `${assetBase}/og.png`, width: 1536, height: 1024, alt: "極速反攻 決勝圈夜間競速" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "極速反攻｜決勝圈競速",
    description: "鎖定前車、逐一超越，向最高 10 倍冠軍獎勵發起攻勢。",
    images: [`${assetBase}/og.png`],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
