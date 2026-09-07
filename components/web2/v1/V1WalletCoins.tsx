'use client'

// V1WalletCoins — a basic "coins held" card for the connected wallet. Reads the gateway chain + USDG address
// from /api/gateway/meta, then reads the native (gas) balance and the USDG balance directly via a viem public
// client on that chain. Read-only display; fails soft (shows nothing rather than erroring the profile).

import { useEffect, useState } from 'react'
import { createPublicClient, http, formatEther, formatUnits } from 'viem'

const ERC20 = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const
const CARD = { background: '#12121C', border: '1px solid rgba(255,255,255,0.07)' }

type Coin = { symbol: string; amount: string; sub: string }

export function V1WalletCoins({ address }: { address?: string }) {
  const [coins, setCoins] = useState<Coin[] | null>(null)

  useEffect(() => {
    if (!address) { setCoins(null); return }
    let alive = true
    ;(async () => {
      try {
        const meta = await (await fetch('/api/gateway/meta')).json()
        if (!meta?.success || !meta?.meta?.rpcUrl || !meta?.meta?.chainId) { if (alive) setCoins([]); return }
        const { rpcUrl, chainId, usdg } = meta.meta as { rpcUrl: string; chainId: number; usdg: string | null }
        const client = createPublicClient({ chain: { id: chainId, name: `chain-${chainId}`, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } }, transport: http(rpcUrl) })
        const out: Coin[] = []
        try {
          const nat = await client.getBalance({ address: address as `0x${string}` })
          out.push({ symbol: 'ETH', amount: Number(formatEther(nat)).toLocaleString('en-US', { maximumFractionDigits: 5 }), sub: 'gas' })
        } catch { /* skip native on read error */ }
        if (usdg) {
          try {
            const bal = (await client.readContract({ address: usdg as `0x${string}`, abi: ERC20, functionName: 'balanceOf', args: [address as `0x${string}`] })) as bigint
            out.push({ symbol: 'USDG', amount: Number(formatUnits(bal, 6)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), sub: 'depositable' })
          } catch { /* skip on read error */ }
        }
        if (alive) setCoins(out)
      } catch { if (alive) setCoins([]) }
    })()
    return () => { alive = false }
  }, [address])

  if (coins == null) return <div className="rounded-[16px] p-5 text-[13.5px]" style={{ ...CARD, color: '#9B9BAD' }}>Loading balances…</div>
  if (coins.length === 0) return null

  return (
    <div className="rounded-[16px] p-5" style={CARD}>
      <div className="text-[12px] uppercase tracking-[0.08em] font-semibold mb-3" style={{ color: '#63636F' }}>Coins held</div>
      <div className="flex flex-col gap-2.5">
        {coins.map((c) => (
          <div key={c.symbol} className="flex items-center justify-between">
            <span className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-[11px]" style={{ background: '#1B1B27', color: '#8A82F4' }}>{c.symbol.slice(0, 4)}</span>
              <span><span className="font-semibold text-[14px]">{c.symbol}</span> <span className="text-[11.5px]" style={{ color: '#63636F' }}>· {c.sub}</span></span>
            </span>
            <span className="font-mono font-semibold text-[14px]">{c.amount}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
