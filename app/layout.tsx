import type { Metadata } from 'next'
import { Plus_Jakarta_Sans, DM_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { Providers } from '@/components/web2/providers'
import { Toaster } from 'sonner'
import { CommandPalette } from '@/components/web2/CommandPalette'
import '@rainbow-me/rainbowkit/styles.css'
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

const BASE_URL = 'https://mintware.finance'

export const metadata: Metadata = {
  title:       'Mintware — The reputation economy of DeFi',
  description: 'Attribution measures every on-chain contribution. Mintware is where those contributions earn rewards.',
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
    title:       'Mintware — The reputation economy of DeFi',
    description: 'Attribution measures every on-chain contribution. Mintware is where those contributions earn rewards.',
    images: [{ url: '/opengraph-image', width: 1200, height: 630 }],
  },
  twitter: {
    card:        'summary_large_image',
    site:        '@MintwareDev',
    creator:     '@MintwareDev',
    title:       'Mintware — The reputation economy of DeFi',
    description: 'Attribution measures every on-chain contribution. Mintware is where those contributions earn rewards.',
    images:      ['/opengraph-image'],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${jakarta.variable} ${dmMono.variable} antialiased`}>
        <Providers>
          {children}
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
