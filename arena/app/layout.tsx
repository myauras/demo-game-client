import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "Arena — 自動亂鬥模擬器";
  const description = "建立參賽陣容，啟動自動戰鬥，見證最後存活的訊號。";

  return {
    title,
    description,
    icons: { icon: "/favicon.png", shortcut: "/favicon.png" },
    openGraph: {
      title,
      description,
      images: [{ url: `${origin}/og.png`, width: 1733, height: 909, alt: "Arena 自動亂鬥模擬器" }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
