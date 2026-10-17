import type { Metadata, Viewport } from 'next';
import { Geist } from 'next/font/google';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import './globals.css';

const geist = Geist({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-geist' });

export const metadata: Metadata = {
  title: 'Pluto',
  description: 'Finanças pessoais',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#7D39EB',
};

// Aplica o tema salvo antes da pintura para evitar flash. Conteudo constante, sem dados externos.
const THEME_BOOT = `try{document.documentElement.dataset.theme=localStorage.getItem('pluto-theme')==='dark'?'dark':'light'}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" data-theme="light" className={geist.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
