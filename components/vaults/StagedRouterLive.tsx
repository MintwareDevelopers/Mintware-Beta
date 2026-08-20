'use client'

// StagedRouterLive — the FUNCTIONAL, on-chain staged-buffer demo. Drives the real
// MintwareStagedLiquidityRouter deployed on Base Sepolia against a self-contained proof rig
// (mock token + mock yield adapter + mock pair vault, all open-mint). Walk the exact product loop
// live: mint a test single side → stage it (earns) → simulate yield → pair it into a pool.
// Every button is a real tx with a Basescan link. Testnet, unaudited, no real value.

import { useCallback, useEffect, useState } from 'react'
import { createPublicClient, http, formatUnits } from 'viem'
import { baseSepolia } from 'viem/chains'
import { useChainId, useSwitchChain, useWriteContract } from 'wagmi'
import { useMintwareIdentity } from '@/lib/web3/useMintwareIdentity'
import { STAGED_ROUTER, stagedRouterTx } from '@/config/stagedRouter'
import { STAGED_ROUTER_ABI, DEMO_ERC20_ABI } from '@/lib/web3/vault/stagedRouterAbi'

const read = createPublicClient({ chain: baseSepolia, transport: http('https://base-sepolia-rpc.publicnode.com') })
const R = STAGED_ROUTER.router as `0x${string}`
const D = STAGED_ROUTER.demo
const K = (n: number) => BigInt(n) * 10n ** 18n
const fmt = (v: bigint) => Number(formatUnits(v, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })

type Log = { label: string; hash: string }

export function StagedRouterLive() {
  const { address } = useMintwareIdentity()
  const chainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()

  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [logs, setLogs] = useState<Log[]>([])
  const [stageId, setStageId] = useState<bigint | null>(null)
  const [susd, setSusd] = useState<bigint>(0n)
  const [staged, setStaged] = useState<bigint>(0n)
  const [active, setActive] = useState(false)

  const onBase = chainId === STAGED_ROUTER.chainId

  const refresh = useCallback(async () => {
    if (!address) return
    try {
      const bal = await read.readContract({ address: D.stagedToken as `0x${string}`, abi: DEMO_ERC20_ABI, functionName: 'balanceOf', args: [address as `0x${string}`] })
      setSusd(bal as bigint)
      if (stageId !== null) {
        const [assets, s] = await Promise.all([
          read.readContract({ address: R, abi: STAGED_ROUTER_ABI, functionName: 'stagedAssets', args: [stageId] }),
          read.readContract({ address: R, abi: STAGED_ROUTER_ABI, functionName: 'stages', args: [stageId] }),
        ])
        setStaged(assets as bigint)
        setActive(Boolean(s[5])) // stages() tuple: [owner,vault,adapter,token,stagedIsToken0,active,shares]
      }
    } catch { /* read best-effort */ }
  }, [address, stageId])

  useEffect(() => { refresh() }, [refresh])

  async function run(label: string, fn: () => Promise<`0x${string}`>) {
    setErr(''); setBusy(label)
    try {
      if (!onBase) await switchChainAsync({ chainId: STAGED_ROUTER.chainId })
      const hash = await fn()
      await read.waitForTransactionReceipt({ hash })
      setLogs((l) => [{ label, hash }, ...l].slice(0, 8))
      await refresh()
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      setErr(m.includes('rejected') || m.includes('User rejected') ? 'Signature declined.' : m.slice(0, 140))
    } finally { setBusy(null) }
  }

  const mintSusd = () => run('Mint 1,000 sUSD', () =>
    writeContractAsync({ address: D.stagedToken as `0x${string}`, abi: DEMO_ERC20_ABI, functionName: 'mint', args: [address as `0x${string}`, K(1000)], chainId: STAGED_ROUTER.chainId }))

  const stage = () => run('Stage 1,000 sUSD', async () => {
    await writeContractAsync({ address: D.stagedToken as `0x${string}`, abi: DEMO_ERC20_ABI, functionName: 'approve', args: [R, K(1000)], chainId: STAGED_ROUTER.chainId })
    const nextId = await read.readContract({ address: R, abi: STAGED_ROUTER_ABI, functionName: 'nextStageId' }) as bigint
    setStageId(nextId)
    return writeContractAsync({ address: R, abi: STAGED_ROUTER_ABI, functionName: 'stage', args: [D.pairVault as `0x${string}`, D.stagedIsToken0, K(1000), D.adapter as `0x${string}`], chainId: STAGED_ROUTER.chainId })
  })

  const accrue = () => run('Simulate +100 yield', () =>
    writeContractAsync({ address: D.stagedToken as `0x${string}`, abi: DEMO_ERC20_ABI, functionName: 'mint', args: [D.adapter as `0x${string}`, K(100)], chainId: STAGED_ROUTER.chainId }))

  const pair = () => run('Pair with 2,000 TKA', async () => {
    if (stageId === null) throw new Error('Stage first')
    await writeContractAsync({ address: D.counterToken as `0x${string}`, abi: DEMO_ERC20_ABI, functionName: 'mint', args: [address as `0x${string}`, K(2000)], chainId: STAGED_ROUTER.chainId })
    await writeContractAsync({ address: D.counterToken as `0x${string}`, abi: DEMO_ERC20_ABI, functionName: 'approve', args: [R, K(2000)], chainId: STAGED_ROUTER.chainId })
    return writeContractAsync({ address: R, abi: STAGED_ROUTER_ABI, functionName: 'pair', args: [stageId, K(2000), 0n, 0], chainId: STAGED_ROUTER.chainId })
  })

  const unstage = () => run('Unstage', () => {
    if (stageId === null) throw new Error('Nothing staged')
    return writeContractAsync({ address: R, abi: STAGED_ROUTER_ABI, functionName: 'unstage', args: [stageId], chainId: STAGED_ROUTER.chainId })
  })

  const B = ({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) => (
    <button onClick={onClick} disabled={!!busy || !on}
      className="glass-pill px-4 py-2.5 text-[13px] font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed text-ink whitespace-nowrap">
      {busy === label ? 'Confirming…' : label}
    </button>
  )

  return (
    <div className="soft-card p-5 mt-10">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <span className="live-chip" /><span className="text-[11px] uppercase tracking-[0.14em] font-semibold text-peri-deep">Live on Base Sepolia</span>
          </div>
          <h3 className="font-atx-display font-bold text-[19px] tracking-[-0.02em] mt-1.5">Try the staged buffer — for real</h3>
          <p className="text-[13px] text-ink-mid leading-[1.5] mt-1 max-w-[60ch]">
            Walk the exact loop against the deployed <a href={stagedRouterTx(STAGED_ROUTER.proof.routerDeployTx)} target="_blank" rel="noopener" className="font-mono text-peri-deep no-underline">router</a> on
            testnet. Mock tokens are open-mint, so you can fund yourself and drive every step. Each button is a real transaction.
          </p>
        </div>
      </div>

      {!address ? (
        <div className="mt-4 text-[13px] text-ink-mid">Connect a wallet to try it.</div>
      ) : (
        <>
          {!onBase && (
            <div className="mt-4 rounded-[10px] bg-[color-mix(in_srgb,var(--color-coral2)_12%,white)] px-3.5 py-2.5 text-[12.5px] text-ink-mid">
              You&apos;re on chain {chainId}. Actions will switch your wallet to Base Sepolia (84532).
            </div>
          )}

          {/* Live state */}
          <div className="grid grid-cols-3 max-[520px]:grid-cols-1 gap-3 mt-4">
            <Stat label="Your sUSD" value={fmt(susd)} />
            <Stat label={stageId !== null ? `Staged (#${stageId})` : 'Staged'} value={active ? fmt(staged) : '—'} sub={active ? 'principal + yield' : 'not staged yet'} />
            <Stat label="Status" value={stageId === null ? 'Ready' : active ? 'Earning' : 'Paired ✓'} tone={active ? 'peri' : undefined} />
          </div>

          {/* Steps */}
          <div className="flex flex-wrap gap-2.5 mt-4">
            <B on label="Mint 1,000 sUSD" onClick={mintSusd} />
            <B on={susd >= K(1000) && (stageId === null || !active)} label="Stage 1,000 sUSD" onClick={stage} />
            <B on={active} label="Simulate +100 yield" onClick={accrue} />
            <B on={active} label="Pair with 2,000 TKA" onClick={pair} />
            <B on={active} label="Unstage" onClick={unstage} />
          </div>

          {err && <div className="mt-3 text-[12.5px] text-[var(--color-coral2)] break-words">{err}</div>}

          {logs.length > 0 && (
            <div className="mt-4 border-t border-hair pt-3 flex flex-col gap-1.5">
              {logs.map((l) => (
                <a key={l.hash} href={stagedRouterTx(l.hash)} target="_blank" rel="noopener"
                  className="text-[12px] text-ink-mid hover:text-ink no-underline flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--color-peri)' }} />
                  <span className="font-medium">{l.label}</span>
                  <span className="font-mono text-ink-soft truncate">{l.hash.slice(0, 14)}…</span>
                </a>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'peri' }) {
  return (
    <div className="rounded-[12px] border border-hair bg-ground-cool px-3 py-2.5">
      <div className="text-[10.5px] uppercase tracking-[0.08em] text-ink-soft">{label}</div>
      <div className="text-[18px] font-bold tracking-[-0.02em] mt-0.5" style={{ color: tone === 'peri' ? 'var(--color-peri-deep)' : undefined }}>{value}</div>
      {sub && <div className="text-[10.5px] text-ink-soft mt-0.5">{sub}</div>}
    </div>
  )
}
