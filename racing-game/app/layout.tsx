import type { Metadata } from "next";
import "./globals.css";

const assetBase = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const siteOrigin = process.env.NEXT_PUBLIC_SITE_ORIGIN;

export const metadata: Metadata = {
  metadataBase: siteOrigin ? new URL(siteOrigin) : undefined,
  title: "極速反攻 V2｜決勝圈競速",
  description: "在直線追擊中挑戰宿敵、累積連超，迎戰五種天氣並逐層揭曉最終獎勵。",
  openGraph: {
    title: "極速反攻 V2｜決勝圈競速",
    description: "挑戰宿敵、累積連超，迎戰多變天氣並向冠軍發起攻勢。",
    type: "website",
    images: [{ url: `${assetBase}/og.png`, width: 1536, height: 1024, alt: "極速反攻 決勝圈夜間競速" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "極速反攻 V2｜決勝圈競速",
    description: "挑戰宿敵、累積連超，迎戰多變天氣並向冠軍發起攻勢。",
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
