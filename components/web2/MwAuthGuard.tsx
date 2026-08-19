'use client'

import { useRouter }              from 'next/navigation'
import { useEffect }              from 'react'
import { useMintwareIdentity }    from '@/lib/web3/useMintwareIdentity'

export function MwAuthGuard({
  children,
  // When true, a disconnected visitor is NOT bounced to '/' — the page renders in a
  // preview state and prompts connect on its own actions. Used by surfaces that show
  // illustrative content pre-connect (e.g. /app/account) so picking "I'm a person"
  // never dead-ends on a blank/redirect. Default false keeps the hard gate elsewhere.
  allowDisconnected = false,
}: {
  children: React.ReactNode
  allowDisconnected?: boolean
}) {
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
    if (isDisconnected && !allowDisconnected) router.replace('/')
  }, [isDisconnected, allowDisconnected, router])

  if (isLoading || (!walletSettled && !isDisconnected)) {
    return <div className="min-h-screen bg-white" />
  }

  if (!isConnected && !allowDisconnected) return null

  return <>{children}</>
}
