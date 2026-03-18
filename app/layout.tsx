import type { Metadata } from 'next'
import { Plus_Jakarta_Sans, DM_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { headers, cookies } from 'next/headers'
import { cookieToInitialState } from 'wagmi'
import { Providers } from '@/components/providers'
import { wagmiConfig } from '@/lib/wagmi'
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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const initialState = cookieToInitialState(wagmiConfig, cookieStore.toString())

  return (
    <html lang="en">
      <body className={`${jakarta.variable} ${dmMono.variable} antialiased`}>
        <Providers initialState={initialState}>
          {children}
        </Providers>
        <Analytics />
      </body>
    </html>
  )
}
