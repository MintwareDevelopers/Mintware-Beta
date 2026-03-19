'use client'

import { useAccount } from 'wagmi'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export function MwAuthGuard({ children }: { children: React.ReactNode }) {
  const { isConnected, isConnecting, isReconnecting } = useAccount()
  const router = useRouter()

  useEffect(() => {
    // Wait for both connecting AND reconnecting to finish before redirecting.
    // isReconnecting = wagmi restoring wallet from localStorage on page load.
    // Without this check, the guard fires during reconnect and kicks users home.
    if (!isConnecting && !isReconnecting && !isConnected) {
      router.replace('/')
    }
  }, [isConnected, isConnecting, isReconnecting, router])

  // Show blank while wallet state is being resolved
  if (!isConnected) {
    return <div className="min-h-screen bg-mw-surface" />
  }

  return <>{children}</>
}
