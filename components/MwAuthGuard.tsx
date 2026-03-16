'use client'

import { useAccount } from 'wagmi'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export function MwAuthGuard({ children }: { children: React.ReactNode }) {
  const { isConnected, isConnecting } = useAccount()
  const router = useRouter()

  useEffect(() => {
    if (!isConnecting && !isConnected) {
      router.replace('/')
    }
  }, [isConnected, isConnecting, router])

  if (!isConnected) {
    return <div style={{ minHeight: '100vh', background: '#F7F6FF' }} />
  }

  return <>{children}</>
}
