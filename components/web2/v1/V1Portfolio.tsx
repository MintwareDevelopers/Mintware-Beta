'use client'

// Portfolio — the V1 account surface (Meteora-style separate tab). The idle-buffer-spend money home:
// Spendable now (the liquid buffer) + Working & earning (the position), wired to /api/gateway/position.
// Dark app skin. Honest not-connected / empty states — no fabricated numbers.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { useMintwarePrivy } from '@/components/web2/providers'
import { useGatewayBuffer } from '@/components/web2/v1/useGatewayBuffer'

type Position = { positionValueAtomic: string | null; bufferBalanceAtomic: string | null; costBasisAtomic?: string | null; unrealizedPnlAtomic?: string | null }

function usdg(atomic: string | null | undefined): string {
  if (atomic == null) return '$0.00'
  const n = Number(BigInt(atomic)) / 1e6
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function num(atomic: string | null | undefined): number {
  if (atomic == null) return 0
  return Number(BigInt(atomic)) / 1e6
}

const CARD = { background: '#12121C', border: '1px solid rgba(255,255,255,0.07)' }

export function V1Portfolio() {
  const { address, isConnected } = useMintwareIdentity()
  const privy = useMintwarePrivy()
  const connect = () => privy.login({ loginMethods: ['wallet', 'email'], walletChainType: 'ethereum-only' })
  const [pos, setPos] = useState<Position | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!address) { setPos(null); return }
    setLoading(true)
    fetch(`/api/gateway/position?address=${address}`)
      .then((r) => r.json())
      .then((d) => setPos(d?.success ? (d.position as Position) : null))
      .catch(() => setPos(null))
      .finally(() => setLoading(false))
  }, [address])

  // Buffer is owner-gated (audit L-03): the public position fetch no longer returns it — the wallet
  // reveals its own balance with a signature. Position value below stays public/immediate.
  const { buffer: bufAtomic, revealed, revealing, reveal } = useGatewayBuffer(address)
  const buffer = num(bufAtomic)
  const working = num(pos?.positionValueAtomic)
  const total = buffer + working
  const hasPosition = total > 0
  const bufPct = total > 0 ? Math.max(3, Math.min(97, Math.round((buffer / total) * 100))) : 8

  return (
    <div>
      <div className="text-[12px] uppercase tracking-[0.13em] font-semibold" style={{ color: '#8A82F4' }}>Portfolio</div>
      <h1 className="font-atx-display font-semibold tracking-[-0.035em] leading-[1.05] text-[clamp(1.7rem,3.4vw,2.4rem)] mt-2.5">
        Your liquid account
      </h1>

      {!isConnected ? (
        <div className="mt-6 rounded-[16px] p-8 flex flex-col items-start gap-4" style={CARD}>
          <p className="text-[15px] max-w-[44ch] leading-[1.55]" style={{ color: '#9B9BAD' }}>
            Connect your wallet to see your spendable buffer and your working balance.
          </p>
          <button
            onClick={connect}
            className="text-[13.5px] font-semibold px-5 py-2.5 rounded-full text-white cursor-pointer"
            style={{ background: 'linear-gradient(135deg,#8A82F4,#5A57DE)', boxShadow: '0 4px 14px rgba(108,108,240,0.35)' }}
          >
            Connect Wallet
          </button>
        </div>
      ) : (
        <div className="mt-6 rounded-[16px] overflow-hidden" style={CARD}>
          <div className="p-7 max-[640px]:p-5 flex justify-between gap-6 flex-wrap items-start">
            <div>
              <div className="text-[12px] uppercase tracking-[0.08em] font-semibold" style={{ color: '#63636F' }}>Spendable now</div>
              {revealed ? (
                <div className="font-mono font-bold tracking-[-0.02em] leading-none text-[clamp(2.4rem,7vw,3.4rem)] mt-2.5">
                  {usdg(bufAtomic)}
                  <span className="text-[0.36em] font-normal ml-1.5" style={{ color: '#63636F' }}>USDG</span>
                </div>
              ) : (
                <div className="mt-2.5">
                  <button
                    onClick={reveal}
                    disabled={revealing}
                    className="font-mono font-bold tracking-[-0.02em] leading-none text-[clamp(1.6rem,4.5vw,2.2rem)] cursor-pointer disabled:cursor-default"
                    style={{ color: '#8A82F4' }}
                  >
                    {revealing ? 'Verifying…' : 'Verify wallet to view →'}
                  </button>
                  <div className="text-[12px] mt-1.5 max-w-[36ch] leading-[1.5]" style={{ color: '#63636F' }}>
                    Your spendable balance is private — sign a message to prove this wallet is yours and reveal it.
                  </div>
                </div>
              )}
              <p className="text-[13px] mt-3 max-w-[36ch] leading-[1.5]" style={{ color: '#9B9BAD' }}>
                Your liquid buffer — kept topped up by yield, ready to spend. Spending it never unwinds your position.
              </p>
            </div>
            <div className="flex gap-2.5 flex-wrap">
              <Link
                href="/v1"
                className="text-[13.5px] font-semibold px-4 py-2.5 rounded-full text-white no-underline"
                style={{ background: 'linear-gradient(135deg,#8A82F4,#5A57DE)' }}
              >
                Add USDG
              </Link>
              {hasPosition && <button className="text-[13.5px] font-semibold px-4 py-2.5 rounded-full cursor-pointer" style={{ color: '#F4F4FA', border: '1px solid rgba(255,255,255,0.12)' }}>Spend →</button>}
              {hasPosition && <button className="text-[13.5px] font-semibold px-4 py-2.5 rounded-full cursor-pointer" style={{ color: '#F4F4FA', border: '1px solid rgba(255,255,255,0.12)' }}>Withdraw</button>}
            </div>
          </div>

          {/* split bar */}
          <div className="flex h-[14px] rounded-full overflow-hidden mx-7 max-[640px]:mx-5">
            <span style={{ width: `${bufPct}%`, background: 'linear-gradient(90deg,#8A82F4,#6C6CF0)' }} />
            <span className="flex-1" style={{ background: 'rgba(138,130,244,0.18)' }} />
          </div>
          <div className="flex gap-7 flex-wrap px-7 max-[640px]:px-5 py-4">
            <Legend color="#8A82F4" label="Spendable buffer" v={revealed ? usdg(bufAtomic) : 'Hidden'} />
            <Legend color="rgba(138,130,244,0.35)" label="Working & earning" v={usdg(pos?.positionValueAtomic)} />
          </div>

          {hasPosition && pos?.costBasisAtomic != null && (
            <div className="flex justify-between items-baseline px-7 max-[640px]:px-5 py-3.5 text-[13px]" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ color: '#9B9BAD' }}>Net vs your deposit <span style={{ color: '#63636F' }}>({usdg(pos.costBasisAtomic)} in)</span></span>
              <span className="font-mono font-bold" style={{ color: num(pos.unrealizedPnlAtomic) >= 0 ? '#34D399' : '#F0736E' }}>
                {num(pos.unrealizedPnlAtomic) >= 0 ? '+' : ''}{usdg(pos.unrealizedPnlAtomic)}
              </span>
            </div>
          )}

          {!hasPosition && !loading && (
            <div className="px-7 max-[640px]:px-5 py-4 text-[13.5px]" style={{ color: '#9B9BAD', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              Nothing working yet.{' '}
              <Link href="/v1" className="no-underline hover:underline" style={{ color: '#8A82F4', fontWeight: 600 }}>Pick a pool →</Link>{' '}
              — it starts earning immediately, and your spendable buffer fills from the yield.
            </div>
          )}
        </div>
      )}

      <p className="text-[12px] mt-5" style={{ color: '#63636F' }}>
        Robinhood testnet.{' '}
        <Link href="/legal" className="no-underline hover:underline" style={{ color: '#8A82F4', fontWeight: 600 }}>Legal →</Link>
      </p>
    </div>
  )
}

function Legend({ color, label, v }: { color: string; label: string; v: string }) {
  return (
    <span className="flex items-center gap-2 text-[13px]" style={{ color: '#9B9BAD' }}>
      <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: color }} />
      {label} <span className="font-mono font-bold ml-1" style={{ color: '#F4F4FA' }}>{v}</span>
    </span>
  )
}
