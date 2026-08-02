import type { Metadata, Viewport } from 'next';
import { Geist_Mono, Noto_Sans_JP } from 'next/font/google';

import { Toaster } from '@/components/ui/sonner';

import './globals.css';

const sans = Noto_Sans_JP({
  variable: '--font-sans',
  subsets: ['latin'],
  display: 'swap',
});

const mono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'repro-talk',
  description: 'リプロダクションと独り言で英語を伸ばす',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'repro-talk', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0a0a0a',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {children}
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
