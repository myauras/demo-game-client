import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://beyblade-neo-spin.auro-7437.chatgpt.site'),
  title: '戰鬥陀螺｜NEO SPIN ARENA',
  description: '一鍵發射、自動對決、一回合定輸贏的戰鬥陀螺 H5 Demo。',
  openGraph: {
    title: '戰鬥陀螺｜NEO SPIN ARENA',
    description: '旋轉・碰撞・一回合定勝負',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: '戰鬥陀螺 H5 Demo' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '戰鬥陀螺｜NEO SPIN ARENA',
    description: '旋轉・碰撞・一回合定勝負',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant"><body>{children}</body></html>;
}
