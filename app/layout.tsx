import type { Metadata } from 'next'
import { Plus_Jakarta_Sans, DM_Mono, Space_Grotesk, JetBrains_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { Providers } from '@/components/web2/providers'
import { Toaster } from 'sonner'
import { CommandPalette } from '@/components/web2/CommandPalette'
import { MwFooter } from '@/components/web2/MwFooter'
import { ScrollProgress, RevealObserver } from '@/components/web2/motion'
import './globals.css'

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
  weight: ['300', '400', '500', '600', '700'],
})

const dmMono = DM_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500'],
})

// ATX Settlemint (Phase-3 design language) — additive; existing pages keep Jakarta/DM Mono
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  weight: ['400', '500', '600', '700'],
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  weight: ['400', '500'],
})

const BASE_URL = 'https://mintware.finance'

export const metadata: Metadata = {
  title:       'Mintware — Never idle. Never locked. Always yours.',
  description: 'Never idle, never locked, always yours. USDC that earns three ways at once and stays spendable — where the LPs who bring real, committed liquidity earn the most.',
  metadataBase: new URL(BASE_URL),
  icons: {
    icon: [
      { url: '/icon.svg',         type: 'image/svg+xml'  },
      { url: '/icon-192.png',     sizes: '192x192'       },
      { url: '/icon-512.png',     sizes: '512x512'       },
      { url: '/icon-dark-32x32.png', sizes: '32x32'      },
    ],
    apple: [{ url: '/apple-icon.png', sizes: '180x180' }],
    shortcut: '/icon-dark-32x32.png',
  },
  openGraph: {
    type:        'website',
    url:         BASE_URL,
    siteName:    'Mintware',
    title:       'Mintware — Never idle. Never locked. Always yours.',
    description: 'Never idle, never locked, always yours. USDC that earns three ways at once and stays spendable — where the LPs who bring real, committed liquidity earn the most.',
    images: [{ url: '/opengraph-image', width: 1200, height: 630 }],
  },
  twitter: {
    card:        'summary_large_image',
    site:        '@Mintware_org',
    creator:     '@Mintware_org',
    title:       'Mintware — Never idle. Never locked. Always yours.',
    description: 'Never idle, never locked, always yours. USDC that earns three ways at once and stays spendable — where the LPs who bring real, committed liquidity earn the most.',
    images:      ['/opengraph-image'],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${jakarta.variable} ${dmMono.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} antialiased`}>
        {/* Enable motion before paint so scroll-reveal never flashes hidden and
            degrades to fully-visible content when JS is off. */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js-motion')" }} />
        <ScrollProgress />
        <RevealObserver />
        <Providers>
          {children}
          <MwFooter />
          <CommandPalette />
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                fontFamily: 'var(--font-jakarta, "Plus Jakarta Sans", sans-serif)',
                fontSize: 13,
                borderRadius: 12,
              },
            }}
          />
        </Providers>
        <Analytics />
      </body>
    </html>
  )
}
