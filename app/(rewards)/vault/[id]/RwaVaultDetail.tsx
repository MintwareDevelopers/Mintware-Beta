'use client'

// Production RWA deal page — rendered by /vault/[id] when vault.surface === 'rwa'.
// Reuses the shared DealSection; fetches the approved deal for this vault.

import { useEffect, useState } from 'react'
import { useAccount, useSignMessage, usePublicClient, useWriteContract } from 'wagmi'
import Link from 'next/link'
import { MwNav } from '@/components/web2/MwNav'
import { DealSection } from '@/components/vaults/DealSection'
import { fmtUSD } from '@/lib/web2/api'
import { buildRedeemRequestMessage } from '@/lib/web3/signedActionMessages'
import type { SocialVault } from '@/lib/web2/vault/types'
import type { DealMeta } from '@/lib/rwa/deal'

// USDC (the RWA vault underlying) by chain — used to approve before an ERC-4626 deposit.
const USDC_BY_CHAIN: Record<number, `0x${string}`> = {
  8453:  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Base mainnet
  84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Base Sepolia
}

const ERC20_APPROVE_ABI = [
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const

const RWA_VAULT_DEPOSIT_ABI = [
  { name: 'deposit', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'assets', type: 'uint256' }, { name: 'receiver', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

function Star({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path fill="currentColor" d="M50,2 L57.46,31.98 L83.94,16.06 L68.02,42.54 L98,50 L68.02,57.46 L83.94,83.94 L57.46,68.02 L50,98 L42.54,68.02 L16.06,83.94 L31.98,57.46 L2,50 L31.98,42.54 L16.06,16.06 L42.54,31.98 Z" />
    </svg>
  )
}

const LABEL = 'font-atx-mono uppercase tracking-[0.14em] text-[11px] text-atx-ink/55'

// Redemption action rail. Deposit is gated on the on-chain RWA vault; the
// redemption REQUEST is the off-chain intent ledger and is live now.
function RwaActionRail({ vaultId, deal, vaultAddress, vrwaAddress, chainId }: {
  vaultId: string
  deal: DealMeta | null
  vaultAddress?: string | null
  vrwaAddress?: string | null
  chainId: number
}) {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<string | null>(null)
  const amt = parseFloat(amount) || 0

  // ── Deposit (wrap) — active once the deal is listed on-chain (vaultAddress set) ──
  const [depAmount, setDepAmount] = useState('')
  const [depBusy, setDepBusy] = useState(false)
  const [depErr, setDepErr] = useState('')
  const [depDone, setDepDone] = useState(false)
  const depAmt = parseFloat(depAmount) || 0
  const usdc = USDC_BY_CHAIN[chainId]
  const canDeposit = Boolean(vaultAddress && usdc && address && depAmt > 0)

  async function deposit() {
    if (!vaultAddress || !usdc || !address || depAmt <= 0 || !publicClient) return
    setDepBusy(true); setDepErr('')
    try {
      const assets = BigInt(Math.round(depAmt * 1e6)) // USDC has 6 decimals
      const approveHash = await writeContractAsync({
        address: usdc, abi: ERC20_APPROVE_ABI, functionName: 'approve',
        args: [vaultAddress as `0x${string}`, assets],
      })
      await publicClient.waitForTransactionReceipt({ hash: approveHash })
      const depositHash = await writeContractAsync({
        address: vaultAddress as `0x${string}`, abi: RWA_VAULT_DEPOSIT_ABI, functionName: 'deposit',
        args: [assets, address],
      })
      await publicClient.waitForTransactionReceipt({ hash: depositHash })
      setDepDone(true); setDepAmount('')
    } catch (e) {
      setDepErr(e instanceof Error ? e.message.slice(0, 140) : 'Deposit failed')
    } finally { setDepBusy(false) }
  }

  async function requestRedeem() {
    if (!address || amt <= 0) return
    setBusy(true); setErr('')
    try {
      const issuedAt = Date.now()
      const authMessage = buildRedeemRequestMessage({ vaultId, wallet: address, sharesUsd: amt, issuedAt })
      const authSignature = await signMessageAsync({ message: authMessage })
      const res = await fetch('/api/vaults/redemptions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vault_id: vaultId, holder: address, shares_usd: amt, issuedAt, authMessage, authSignature }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? `HTTP ${res.status}`) }
      const d = await res.json()
      setDone(d.settles_at ?? null)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Request failed') }
    finally { setBusy(false) }
  }

  return (
    <div className="border border-atx-ink bg-atx-bone sticky top-[74px]">
      <div className="px-[18px] py-3 border-b border-atx-ink bg-atx-ink text-white font-atx-mono text-[12px] uppercase tracking-[0.1em]">
        Invest
      </div>
      <div className="p-[18px] flex flex-col gap-3">
        <div>
          <div className={`${LABEL} mb-1`}>Min investment</div>
          <div className="font-atx-mono text-[20px]">{deal && deal.minInvestmentUsd > 0 ? fmtUSD(deal.minInvestmentUsd) : '—'}</div>
        </div>
        <p className="font-atx-mono text-[11px] text-atx-ink/55 leading-[1.55]">
          Deposit mints vRWA 1:1 with your shares — a bearer instrument you can trade freely.
          KYC ({deal?.kycTierRequired ?? 'BASIC'}) is required only to redeem the underlying.
        </p>
        {vaultAddress ? (
          depDone ? (
            <div className="border border-atx-ink bg-atx-panel p-3 font-atx-mono text-[11px] leading-[1.5]">
              <strong>Deposit confirmed.</strong> vRWA minted to your wallet.
              <button onClick={() => setDepDone(false)} className="block mt-1 text-atx-blue">Deposit more →</button>
            </div>
          ) : (
            <>
              <div className={`${LABEL} mb-0.5`}>Deposit · USDC</div>
              <input
                value={depAmount}
                onChange={(e) => setDepAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                inputMode="decimal"
                placeholder="0.00"
                className="w-full border border-atx-ink bg-transparent px-3 py-2.5 font-atx-mono text-[16px] outline-none focus:border-atx-blue"
              />
              <button
                onClick={deposit}
                disabled={depBusy || !canDeposit}
                className="w-full font-semibold text-[14px] py-3 border border-atx-ink bg-atx-coral text-atx-ink uppercase tracking-[0.04em] disabled:opacity-45 disabled:cursor-not-allowed"
              >
                {depBusy ? 'Depositing…' : !address ? 'Connect to deposit' : 'Deposit'}
              </button>
              {depErr && <div className="text-[11px] text-atx-clay font-atx-display">{depErr}</div>}
            </>
          )
        ) : (
          <button disabled className="w-full font-semibold text-[14px] py-3 border border-atx-ink bg-atx-coral text-atx-ink uppercase tracking-[0.04em] disabled:opacity-45">
            Deposit
          </button>
        )}
        {vrwaAddress && (
          <Link href={`/swap?buy=${vrwaAddress}`} className="text-center font-atx-mono text-[11px] text-atx-blue no-underline hover:underline">
            Trade vRWA on the secondary market →
          </Link>
        )}
        <div className="border-t border-atx-ink/20 pt-3" />
        {done ? (
          <div className="border border-atx-ink bg-atx-panel p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2.5 h-2.5 bg-atx-acid border border-atx-ink inline-block" />
              <span className="font-atx-mono text-[12px] font-bold uppercase tracking-[0.06em]">Redemption requested</span>
            </div>
            <p className="font-atx-mono text-[11px] text-atx-ink/55 leading-[1.5]">
              Settles by <strong>{done}</strong> after the issuer&apos;s KYC check.{' '}
              <Link href="/redemptions" className="text-atx-blue no-underline hover:underline">Track it →</Link>
            </p>
          </div>
        ) : (
          <>
            <div className={`${LABEL} mb-0.5`}>Request redemption · USDC value</div>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              placeholder="0.00"
              className="w-full border border-atx-ink bg-transparent px-3 py-2.5 font-atx-mono text-[16px] outline-none focus:border-atx-blue"
            />
            <button
              onClick={requestRedeem}
              disabled={busy || amt <= 0 || !address}
              className="w-full font-semibold text-[13px] py-2.5 border border-atx-ink bg-atx-panel text-atx-ink uppercase tracking-[0.04em] disabled:opacity-45 disabled:cursor-not-allowed"
            >
              {busy ? 'Requesting…' : !address ? 'Connect to redeem' : 'Request Redeem'}
            </button>
            {err && <div className="text-[11px] text-atx-clay font-atx-display">{err}</div>}
            <p className="font-atx-mono text-[11px] text-atx-ink/45 leading-[1.5]">
              Starts a {deal?.settleDays ?? 30}-day settlement window; the issuer settles after a KYC check.
            </p>
          </>
        )}
        <div className="border-t border-atx-ink/20 pt-3 font-atx-mono text-[10px] text-atx-ink/40 leading-[1.5]">
          {vaultAddress
            ? 'Deposits mint vRWA on-chain. Deal terms are enforced by the SPV wrapper + oracle price bands.'
            : 'On-chain deposits open once the vault is live on-chain. Deal terms are enforced by the SPV wrapper + oracle price bands.'}
        </div>
      </div>
    </div>
  )
}

export function RwaVaultDetailView({ vault }: { vault: SocialVault }) {
  const [deal, setDeal] = useState<DealMeta | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    fetch(`/api/vaults/${vault.id}/deal`)
      .then((r) => r.json())
      .then((d) => { if (alive) { setDeal(d.deal ?? null); setLoaded(true) } })
      .catch(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [vault.id])

  const stats: [string, string][] = [
    ['Total TVL', fmtUSD(vault.tvl_usdc ?? 0)],
    ['Target APY', deal?.targetApyPct != null ? `${deal.targetApyPct}%` : '—'],
    ['Settlement', deal ? `${deal.settleDays}d` : '—'],
    ['Price band', deal?.priceBand ?? '—'],
  ]

  return (
    <div className="bg-atx-bone min-h-screen font-atx-display text-atx-ink [&_*]:rounded-none">
      <MwNav />
      <div className="max-w-[960px] mx-auto px-7 pt-7 pb-[60px] max-[800px]:px-4 max-[800px]:pt-5">
        {/* Breadcrumb */}
        <div className="mb-4 flex items-center gap-2">
          <Link href="/vaults" className="text-[13px] text-atx-ink/55 no-underline hover:text-atx-ink">← Vaults</Link>
          <span className="text-atx-ink/30">/</span>
          <span className="text-[13px] text-atx-ink font-semibold">{vault.name}</span>
        </div>

        {/* Header */}
        <div className="border border-atx-ink bg-atx-panel p-6 mb-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-atx-mono text-[11px] uppercase tracking-[0.08em] px-2 py-1 border border-atx-ink bg-atx-coral text-atx-ink">RWA</span>
            {vault.provider && <span className="font-atx-mono text-[12px] text-atx-ink/55">issuer · {vault.provider}</span>}
          </div>
          <h1 className="text-[28px] font-extrabold tracking-[-0.02em] leading-[1.1]">{vault.name}</h1>
          <div className="grid grid-cols-4 max-[620px]:grid-cols-2 border border-atx-ink mt-5">
            {stats.map(([k, v], i) => (
              <div key={k} className={`px-4 py-3 ${i < 3 ? 'border-r border-atx-ink/20' : ''} max-[620px]:[&:nth-child(2)]:border-r-0 ${i < 2 ? 'max-[620px]:border-b max-[620px]:border-atx-ink/20' : ''}`}>
                <div className={`${LABEL} text-[9px] mb-1`}>{k}</div>
                <div className="font-atx-mono text-[15px] font-bold">{v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Body: deal + action rail */}
        <div className="grid grid-cols-[1fr_340px] gap-6 items-start max-[820px]:grid-cols-1">
          <div className="min-w-0">
            {!loaded ? (
              <div className="h-40 border border-atx-ink/20 bg-atx-panel animate-pulse" />
            ) : deal ? (
              <DealSection deal={deal} />
            ) : (
              <div className="border border-atx-ink/25 border-l-[3px] border-l-atx-clay bg-atx-panel px-4 py-3.5 flex items-start gap-2.5">
                <Star className="w-4 h-4 shrink-0 mt-0.5 text-atx-clay" />
                <div className="text-[12px] text-atx-ink/70 leading-[1.55]">
                  This deal&apos;s page is still in Mintware review. Full deal details publish once approved.
                </div>
              </div>
            )}
          </div>
          <RwaActionRail
            vaultId={vault.id}
            deal={deal}
            vaultAddress={vault.vault_address}
            vrwaAddress={vault.vrwa_address}
            chainId={vault.chain_id}
          />
        </div>
      </div>
    </div>
  )
}
