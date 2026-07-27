'use client'

import { useRouter }              from 'next/navigation'
import { useEffect }              from 'react'
import { useMintwareIdentity }    from '@/lib/web3/useMintwareIdentity'

export function MwAuthGuard({ children }: { children: React.ReactNode }) {
  const { isConnected, isReady, walletSettled, evmStatus } = useMintwareIdentity()
  const router = useRouter()

  if (process.env.NODE_ENV === 'development') {
    return <>{children}</>
  }

  const isLoading =
    !isReady ||
    evmStatus === 'reconnecting' ||
    evmStatus === 'connecting'
  const isDisconnected = !isLoading && !isConnected

  useEffect(() => {
    if (isDisconnected) router.replace('/')
  }, [isDisconnected, router])

  if (isLoading || (!walletSettled && !isDisconnected)) {
    return <div className="min-h-screen bg-atx-bone" />
  }

  if (!isConnected) return null

  return <>{children}</>
}
