import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000'),
  title: 'Linha Um — Discador assistido',
  description: 'Discagem paralela responsável para equipes comerciais.',
  openGraph: {
    title: 'Linha Um — Discador assistido',
    description: 'Discagem paralela. Uma conversa por vez.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Linha Um — Discagem paralela. Uma conversa por vez.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Linha Um — Discador assistido',
    description: 'Discagem paralela. Uma conversa por vez.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
