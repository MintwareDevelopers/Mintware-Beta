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

export const metadata: Metadata = {
  title: 'Mintware — The reputation economy of DeFi',
  description: 'Attribution measures every contribution. Mintware is where those contributions earn rewards.',
  icons: {
    icon: [
      { url: '/icon-light-32x32.png', media: '(prefers-color-scheme: light)' },
      { url: '/icon-dark-32x32.png',  media: '(prefers-color-scheme: dark)'  },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${jakarta.variable} ${dmMono.variable} antialiased`}>
        <Providers>
          {children}
          <CommandPalette />
        </Providers>
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
        <Analytics />
      </body>
    </html>
  )
}
