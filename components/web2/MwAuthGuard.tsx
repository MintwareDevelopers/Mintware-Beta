'use client'

import { useAccount } from 'wagmi'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export function MwAuthGuard({ children }: { children: React.ReactNode }) {
  const { status } = useAccount()
  const router = useRouter()

  useEffect(() => {
    // Only redirect when wagmi has definitively resolved to disconnected.
    // 'reconnecting' = restoring connection from cookie storage — never redirect here.
    // 'connecting'   = fresh connect in progress — never redirect here.
    // 'disconnected' = no wallet, no stored session — redirect to home.
    if (status === 'disconnected') {
      router.replace('/')
    }
  }, [status, router])

  // Show blank while connecting / reconnecting from cookie storage
  if (status !== 'connected') {
    return <div className="min-h-screen bg-mw-surface" />
  }

  return <>{children}</>
}
