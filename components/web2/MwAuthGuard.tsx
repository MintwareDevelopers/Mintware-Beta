'use client'

import { useAccount }             from 'wagmi'
import { useWallet }              from '@solana/wallet-adapter-react'
import { useRouter }              from 'next/navigation'
import { useEffect }              from 'react'

export function MwAuthGuard({ children }: { children: React.ReactNode }) {
  const { status: evmStatus }            = useAccount()
  const { connected: solConnected, connecting: solConnecting } = useWallet()
  const router = useRouter()

  // In local dev, skip auth so pages can be tweaked without a wallet
  if (process.env.NODE_ENV === 'development') {
    return <>{children}</>
  }

  const isLoading     = evmStatus === 'reconnecting' || evmStatus === 'connecting' || solConnecting
  const isConnected   = evmStatus === 'connected' || solConnected
  const isDisconnected = !isLoading && !isConnected

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (isDisconnected) router.replace('/')
  }, [isDisconnected, router])

  if (isLoading || (!isConnected && !isDisconnected)) {
    return <div className="min-h-screen bg-mw-surface" />
  }

  if (!isConnected) return null

  return <>{children}</>
}
