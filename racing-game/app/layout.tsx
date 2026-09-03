import type { Metadata } from "next";
import "./globals.css";

const assetBase = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const siteOrigin = process.env.NEXT_PUBLIC_SITE_ORIGIN;

export const metadata: Metadata = {
  metadataBase: siteOrigin ? new URL(siteOrigin) : undefined,
  title: "極速反攻 V3｜決勝圈競速",
  description: "在直線追擊中提升名次、累積連超與里程碑，向冠軍發起最後攻勢。",
  openGraph: {
    title: "極速反攻 V3｜決勝圈競速",
    description: "提升名次、累積連超與里程碑，向冠軍發起最後攻勢。",
    type: "website",
    images: [{ url: `${assetBase}/og.png`, width: 1536, height: 1024, alt: "極速反攻 決勝圈夜間競速" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "極速反攻 V3｜決勝圈競速",
    description: "提升名次、累積連超與里程碑，向冠軍發起最後攻勢。",
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
