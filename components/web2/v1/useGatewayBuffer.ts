'use client'

// Owner-gated reveal of the off-chain spendable-buffer balance (audit L-03). The public
// GET /api/gateway/position no longer discloses `bufferBalanceAtomic`; a wallet reads its own buffer
// by signing an EIP-191 message that POST /api/gateway/position verifies. This hook drives that reveal
// on an explicit user gesture (no auto-sign-on-mount — wallets reject non-gesture signing, and a
// surprise popup on a read is bad UX). Until revealed, callers show a "Verify to view" affordance and
// the rest of the page (position value, PnL — all chain-derived) renders normally.

import { useCallback, useEffect, useState } from 'react'
import { useSignMessage } from 'wagmi'
import { buildGatewayBufferMessage } from '@/lib/web3/signedActionMessages'

export function useGatewayBuffer(address: string | null | undefined, pool?: string) {
  const { signMessageAsync } = useSignMessage()
  const [buffer, setBuffer] = useState<string | null>(null)
  const [revealing, setRevealing] = useState(false)
  const [error, setError] = useState('')

  // Reset whenever the connected wallet changes — one wallet must never see another's revealed value.
  useEffect(() => {
    setBuffer(null)
    setError('')
    setRevealing(false)
  }, [address, pool])

  const reveal = useCallback(async () => {
    if (!address) return
    setError('')
    setRevealing(true)
    try {
      const issuedAt = Date.now()
      const authMessage = buildGatewayBufferMessage({ address, issuedAt, pool: pool ?? null })
      const authSignature = await signMessageAsync({ message: authMessage })
      const res = await fetch('/api/gateway/position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, pool: pool ?? null, authMessage, authSignature, issuedAt }),
      })
      const d = await res.json()
      if (!d?.success) throw new Error(d?.error ?? 'reveal_failed')
      setBuffer(String(d.bufferBalanceAtomic ?? '0'))
    } catch (e) {
      // Rejected signature / failure ⇒ leave the buffer hidden; the page keeps working on public data.
      setError((e as Error)?.message ?? 'reveal_failed')
    } finally {
      setRevealing(false)
    }
  }, [address, pool, signMessageAsync])

  return { buffer, revealed: buffer != null, revealing, error, reveal }
}
