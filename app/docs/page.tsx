'use client'

// /docs — developer and user docs for the current product (rewritten 2026-10-31 after the simplification). One
// engine per asset (MarketEngine), the RWA property demo, Swap, Treasury yield (Earn), the card preview, and agent
// payments. Facts come from .claude/rules/{lp-gateway,payments-ypn,rwa-liquidity,agents}.md and
// config/deployments.json; keep them in step when those change. Retired designs (LP Gateway, ULV/JIT, am-AMM,
// matched launch, Liquid Sovereign Account, senior/junior) are not described here.

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'

type Nav = (id: string) => void

const EY = 'text-[12.5px] uppercase tracking-[0.08em] font-semibold'
const SUB = 'text-[17px] text-ink-mid leading-[1.55] mt-3 mb-2 max-w-[62ch]'

function Ln({ to, nav, children }: { to: string; nav: Nav; children: ReactNode }) {
  return <button onClick={() => nav(to)} className="font-semibold underline-offset-2 hover:underline cursor-pointer bg-transparent border-0 p-0" style={{ color: 'var(--mw-peri-deep)' }}>{children}</button>
}
function Note({ k, children, tone = 'info' }: { k: string; children: ReactNode; tone?: 'info' | 'warn' }) {
  return (
    <div className="rounded-[16px] px-[18px] py-4 my-5" style={tone === 'warn' ? { background: '#FBEEE7', color: '#7A3416' } : { background: 'var(--mw-band)' }}>
      <div className="text-[11px] uppercase tracking-[0.1em] font-semibold mb-1.5" style={{ color: tone === 'warn' ? '#9A3F1C' : 'var(--mw-peri-deep)' }}>{k}</div>
      <div className="text-[14.5px] leading-[1.55]" style={tone === 'warn' ? undefined : { color: 'var(--mw-ink-2)' }}>{children}</div>
    </div>
  )
}
function Steps({ items }: { items: [string, string][] }) {
  return (
    <ol className="!pl-0 list-none my-5 flex flex-col gap-2.5">
      {items.map(([t, d], i) => (
        <li key={t} className="!pl-0 before:!content-none flex gap-3.5 rounded-[16px] px-4 py-3.5" style={{ background: 'var(--mw-ground)', boxShadow: 'var(--mw-inset)' }}>
          <span className="flex-none w-7 h-7 rounded-full grid place-items-center text-[13px] font-semibold text-white" style={{ background: 'var(--mw-btn)' }}>{i + 1}</span>
          <div><div className="font-semibold text-[15px] text-ink">{t}</div><div className="text-[14px] leading-[1.5] mt-0.5" style={{ color: 'var(--mw-ink-2)' }}>{d}</div></div>
        </li>
      ))}
    </ol>
  )
}
function Status({ s }: { s: 'live' | 'testnet' | 'demo' | 'preview' | 'retired' }) {
  const map = {
    live: ['Live', 'bg-[#E3F4EA] text-[#0F7A43]'],
    testnet: ['Testnet', 'bg-[#EDE9FB] text-[#4B2FA0]'],
    demo: ['Testnet demo', 'bg-[#EDE9FB] text-[#4B2FA0]'],
    preview: ['Simulated preview', 'bg-white text-ink-mid mw-tex-dots'],
    retired: ['Retired', 'bg-white text-ink-mid'],
  } as const
  const [label, cls] = map[s]
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap ${cls}`}>{label}</span>
}
const TABLE = 'w-full border-collapse text-[13.5px] my-4 [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left [&_th]:align-top [&_th]:text-[11px] [&_th]:uppercase [&_th]:tracking-[0.06em] [&_th]:text-ink-soft [&_th]:font-semibold [&_th]:border-b [&_th]:border-[var(--mw-line)] [&_td]:px-3 [&_td]:py-3 [&_td]:text-left [&_td]:align-top [&_td]:leading-[1.45] [&_td]:border-b [&_td]:border-[var(--mw-line)]'
function Addr({ a }: { a: string }) {
  return <code className="break-all">{a}</code>
}

// ── sections ─────────────────────────────────────────────────────────────────
function Overview({ nav }: { nav: Nav }) {
  return (
    <>
      <div className={EY} style={{ color: 'var(--mw-peri-deep)' }}>Start here · Overview</div>
      <h1>One engine per asset.</h1>
      <p className={SUB}>Mintware gives each tokenized asset its own isolated, non-custodial market. Liquidity is live on testnet today; collateral and credit come next.</p>
      <p>Tokenizing a stock, a bar of gold or a land parcel makes it divisible, not liquid. Each Mintware market is one <b>MarketEngine</b> wrapped around one curated Uniswap v4 pool. You provide one or both of the pool&apos;s tokens, receive shares in that market, and withdraw your share in both tokens when you choose. One market&apos;s trouble stays in that market.</p>
      <div className="overflow-x-auto"><table className={TABLE}>
        <thead><tr><th>What</th><th>Where</th><th>Status</th></tr></thead>
        <tbody>
          <tr><td><b>Markets</b> — provide liquidity to a curated pool</td><td><Link href="/app/markets">/app/markets</Link></td><td><Status s="testnet" /></td></tr>
          <tr><td><b>Property market</b> — a fictional land parcel with an appraisal-anchored market</td><td><Link href="/app/rwas">/app/rwas</Link></td><td><Status s="demo" /></td></tr>
          <tr><td><b>Swap</b> — cross-chain swap routed by LI.FI</td><td><Link href="/app/swap">/app/swap</Link></td><td><Status s="live" /></td></tr>
          <tr><td><b>Treasury yield</b> — an organisation supplies USDC to an Earn vault</td><td>Team workspace</td><td><Status s="testnet" /></td></tr>
          <tr><td><b>Card</b> — spend from a card balance that refills from Earn</td><td><Link href="/app/previews/card">/app/previews/card</Link></td><td><Status s="preview" /></td></tr>
          <tr><td><b>Agent payments</b> — pay and get paid per request over x402</td><td><Link href="/agents">/agents</Link></td><td><Status s="live" /></td></tr>
        </tbody>
      </table></div>
      <Note k="Honest status" tone="warn">Everything except Swap and agent payments runs on testnets with mock tokens. Nothing is externally audited, and an external audit gates any real value. Swap trades real tokens on mainnet.</Note>
      <Note k="Next">How a market works: <Ln to="markets" nav={nav}>Markets</Ln>. What can go wrong: <Ln to="risks" nav={nav}>Risks</Ln>. Every address: <Ln to="contracts" nav={nav}>Contracts</Ln>.</Note>
    </>
  )
}

function Markets({ nav }: { nav: Nav }) {
  return (
    <>
      <div className={EY} style={{ color: 'var(--mw-peri-deep)' }}>Products · Markets</div>
      <h1>Markets <span className="text-ink-soft">— the MarketEngine</span></h1>
      <p className={SUB}>One engine per curated Uniswap v4 pool. One share token per engine, valued in the pool&apos;s quote asset.</p>
      <h2>How it works</h2>
      <Steps items={[
        ['Provide one or both tokens', 'Deposit either pool token, or both. The engine values what you bring against a fresh price mark and mints shares in that market. You set a minimum number of shares, so a moved price can’t short you.'],
        ['The engine puts it to work', 'Capital sits in a resting liquidity band in the pool and in per-token holding adapters. The engine’s operator deploys and removes liquidity, collects trading fees and re-centres the band within fixed limits.'],
        ['Withdraw your share in both tokens', 'Withdrawals are pro-rata and in kind: you get your share of each token the market holds. You set a minimum for each token. There is no lockup.'],
      ]} />
      <h2>Rules the contract enforces</h2>
      <ul>
        <li>A deposit needs a fresh price mark, and the pool’s price must sit within a set distance of it.</li>
        <li>Total value and the share held in the pool are capped per market.</li>
        <li>Pausing a market blocks new deposits. It never blocks withdrawals.</li>
        <li>If one token can’t be delivered on a withdrawal, you keep shares worth what wasn’t delivered.</li>
      </ul>
      <h2>Live markets (testnet)</h2>
      <div className="overflow-x-auto"><table className={TABLE}>
        <thead><tr><th>Pair</th><th>Chain</th><th>Notes</th></tr></thead>
        <tbody>
          <tr><td><b>PONS / USDG</b></td><td>Robinhood Chain testnet</td><td>0.3% pool fee. Mock tokens. Holding adapters hold assets ready and earn nothing. Fixed test price mark.</td></tr>
          <tr><td><b>WETH / USDC</b></td><td>Base Sepolia</td><td>0.25% pool fee. Fixed test price mark.</td></tr>
        </tbody>
      </table></div>
      <h2>Discover and curation</h2>
      <p>The watchlist on <Link href="/app/markets">Markets</Link> reads real Robinhood Chain mainnet pools from GeckoTerminal and ranks them on depth, age and trading. The score ranks; it never certifies. A person curates which pools get a market, and markets open on mainnet only after an external audit.</p>
      <Note k="Read next">What can go wrong with a position: <Ln to="risks" nav={nav}>Risks</Ln>.</Note>
    </>
  )
}

function Rwa({ nav }: { nav: Nav }) {
  return (
    <>
      <div className={EY} style={{ color: 'var(--mw-peri-deep)' }}>Products · Real-world assets</div>
      <h1>The property market <span className="text-ink-soft">— a demo</span></h1>
      <p className={SUB}>A live market for a fictional land parcel, Willow Creek Parcel 7, on Base Sepolia. It shows how a regulated asset can trade without breaking its ownership rules.</p>
      <ul>
        <li><b>Priced around an appraisal.</b> A Uniswap v4 hook keeps trades within a band around the issuer’s appraisal. A swap that would end outside the band reverts, unless it moves the price back toward the appraisal.</li>
        <li><b>Appraisals can’t jump.</b> Each update is step-capped and rate-limited, with a rolling 24-hour cap on total movement. Keeper and configuration changes wait 48 hours once the pool is live.</li>
        <li><b>Only verified holders own it.</b> The property token is permissioned: both sides of every transfer must be verified, so an unverified buyer can’t receive it.</li>
        <li><b>A stale appraisal stops trading, not exits.</b> Trading halts, and liquidity providers keep a grace window to withdraw.</li>
      </ul>
      <Note k="Demo only" tone="warn">The property, its token, the dollar token and the lending yield are testnet stand-ins with no value. Open the <Link href="/app/rwas">property market</Link> and its <Link href="/app/rwas/proof">on-chain proof</Link>. Addresses are under <Ln to="contracts" nav={nav}>Contracts</Ln>.</Note>
    </>
  )
}

function Swap() {
  return (
    <>
      <div className={EY} style={{ color: 'var(--mw-peri-deep)' }}>Products · Swap</div>
      <h1>Swap</h1>
      <p className={SUB}>A cross-chain swap routed by LI.FI across Ethereum, Base and Arbitrum.</p>
      <p>You pick the network and the two tokens. The route, the platform fee and the network fee show before your wallet opens. Keep a little of the network’s native token for gas.</p>
      <Note k="Real funds" tone="warn">Swap is the one part of Mintware that moves real tokens on mainnet. Everything else runs on testnet.</Note>
      <p><Link href="/app/swap">Open Swap →</Link></p>
    </>
  )
}

function Earn() {
  return (
    <>
      <div className={EY} style={{ color: 'var(--mw-peri-deep)' }}>Products · Treasury yield</div>
      <h1>Treasury yield <span className="text-ink-soft">— the Earn vault</span></h1>
      <p className={SUB}>A single-asset ERC-4626 vault (<code>MintwareYieldVault</code>, shares called <code>mwEARN</code>) over one yield adapter. Organisations use it in the Team workspace.</p>
      <ul>
        <li>You supply USDC and receive shares; your position is held by your own wallet.</li>
        <li>The rate is whatever the adapter earns. It varies, it isn’t guaranteed, and it is zero when a vault uses a no-yield adapter, as some testnet vaults do.</li>
        <li>Pausing blocks deposits only. Withdrawals stay open.</li>
        <li>If the yield source can’t pay everything at once, a withdrawal pays what it can and you keep the shares for the rest.</li>
      </ul>
      <Note k="Status">Testnet, unaudited. The Team workspace is in private preview.</Note>
    </>
  )
}

function Card() {
  return (
    <>
      <div className={EY} style={{ color: 'var(--mw-peri-deep)' }}>Products · Card</div>
      <h1>Card <span className="text-ink-soft">— in development</span></h1>
      <p className={SUB}>A card that spends from a small card balance, which refills from your Earn balance by only what you spent.</p>
      <ul>
        <li>Cards will be issued with Bridge and Stripe. They are not live, and nothing in the app is a live card or an offer.</li>
        <li>The refill contract (<code>MintwarePaymentGateway</code>) only refills: it redeems a member’s Earn shares to that member’s own registered card wallet, within daily caps.</li>
        <li>A new refill destination waits 48 hours before it can be used, and the member can revoke it at any time.</li>
        <li>Purchases are never settled from vault shares directly.</li>
      </ul>
      <p>See how it would feel in the <Link href="/app/previews/card">card preview</Link> (simulated), or read <Link href="/cards">how the card works</Link>.</p>
    </>
  )
}

function Agents() {
  return (
    <>
      <div className={EY} style={{ color: 'var(--mw-peri-deep)' }}>Products · Agents</div>
      <h1>Agent payments</h1>
      <p className={SUB}>Pay per request and get paid per request over x402, with an on-chain identity under ERC-8004.</p>
      <Steps items={[
        ['The agent asks', 'A normal HTTP request to an x402 endpoint.'],
        ['The API names a price', 'It answers 402 with an amount in USDC.'],
        ['The agent pays and retries', 'It signs a USDC transfer (EIP-3009) from its own wallet and retries. The seller receives the USDC directly.'],
      ]} />
      <ul>
        <li>Mintware’s own score API is sold this way at <code>/api/x402/score</code>.</li>
        <li>Mintware is ERC-8004 agent <code>#37297</code> on Base.</li>
        <li>Tools for agent runtimes: <code>@mintwarehq/mcp-server</code> (Claude, Cursor), <code>@mintwarehq/agentkit-actions</code> (Coinbase AgentKit) and <code>@mintwarehq/eliza-plugin</code> (ElizaOS).</li>
      </ul>
      <Note k="Not built yet">An agent balance that earns between jobs is a plan. The testnet parking vault holds USDC without yield, and x402 payments don’t spend from it.</Note>
    </>
  )
}

function Risks() {
  return (
    <>
      <div className={EY} style={{ color: 'var(--mw-peri-deep)' }}>Trust · Risks</div>
      <h1>Risks</h1>
      <p className={SUB}>Read these before providing to any market. Full text: <Link href="/risk-disclosures">risk disclosures</Link>.</p>
      <ul>
        <li><b>Impermanent loss.</b> When prices move, you can end up with more of the token that fell. Fees may not make up for it.</li>
        <li><b>Exits can be delayed.</b> There is no lockup, but a withdrawal can wait if a token’s issuer pauses or freezes it, or a market is short of liquidity.</li>
        <li><b>Issuer controls.</b> Regulated tokens can be paused, frozen or wiped by their issuer. That can leave part of a position unavailable.</li>
        <li><b>Price marks.</b> Deposits rely on a price mark. On testnet the mark is fixed for testing; mainnet needs a verified source.</li>
        <li><b>Smart-contract risk.</b> The contracts are unaudited.</li>
        <li><b>No yield on testnet holding adapters.</b> Assets waiting outside the pool earn nothing on today’s testnet markets.</li>
      </ul>
      <Note k="Never" tone="warn">A position is not a deposit or a savings product, and no return is fixed or guaranteed.</Note>
    </>
  )
}

function Security({ nav }: { nav: Nav }) {
  return (
    <>
      <div className={EY} style={{ color: 'var(--mw-peri-deep)' }}>Trust · Security</div>
      <h1>Security and custody</h1>
      <p className={SUB}>Non-custodial by construction, and unaudited until an external audit says otherwise.</p>
      <h2>Custody</h2>
      <p>You interact with the contracts from your own wallet. Mintware never holds your keys. Sign-in and wallets run on Privy. Each market has an operator who can deploy and remove liquidity, collect fees, swap idle balances within set limits, re-centre the band and pause deposits. Pausing doesn’t block withdrawals.</p>
      <h2>What protects a position</h2>
      <ul>
        <li>Minimum-shares on deposit and minimum-outputs on withdrawal, set by you.</li>
        <li>Deposits refused when the pool price strays from the mark.</li>
        <li>Per-market caps on total value and on the amount in the pool.</li>
        <li>Pause stops deposits, never withdrawals.</li>
        <li>Each asset in its own engine, so a problem stays in that market.</li>
      </ul>
      <h2>Audit status</h2>
      <p>The contracts have been through internal reviews, fuzzing and invariant testing. None has had an external audit. Real value waits for one.</p>
      <Note k="Addresses">Every deployed contract is listed under <Ln to="contracts" nav={nav}>Contracts</Ln>.</Note>
    </>
  )
}

function Contracts() {
  return (
    <>
      <div className={EY} style={{ color: 'var(--mw-peri-deep)' }}>Reference · Contracts</div>
      <h1>Contracts</h1>
      <p className={SUB}>The current deployments. The one committed record is <code>config/deployments.json</code>; if this page and that file disagree, the file wins.</p>
      <h2>Robinhood Chain testnet</h2>
      <div className="overflow-x-auto"><table className={TABLE}>
        <thead><tr><th>Contract</th><th>Address</th></tr></thead>
        <tbody>
          <tr><td><b>MarketEngine</b> (PONS / USDG)</td><td><Addr a="0x38E426D6671FB2c07C07a468e59f954Dcd0eDeb8" /></td></tr>
          <tr><td>Lifecycle module</td><td><Addr a="0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421" /></td></tr>
          <tr><td>Holding adapter · tUSDG</td><td><Addr a="0xFC17B41e102DA194083a3BfD0df49F79Fd1FcA62" /></td></tr>
          <tr><td>Holding adapter · tPONS</td><td><Addr a="0xDc11D311364a175d992bB47484BA9DFaa3A0b73b" /></td></tr>
          <tr><td>Fixed test mark</td><td><Addr a="0xA7e84b45E59bccC5F1227e706Cc335dc7ab6ed10" /></td></tr>
        </tbody>
      </table></div>
      <h2>Base Sepolia</h2>
      <div className="overflow-x-auto"><table className={TABLE}>
        <thead><tr><th>Contract</th><th>Address</th></tr></thead>
        <tbody>
          <tr><td><b>MarketEngine</b> (WETH / USDC)</td><td><Addr a="0x961534db8C0EbB7cEb729E74CaB698A83A9c827e" /></td></tr>
          <tr><td>Adapter · USDC</td><td><Addr a="0xc1287f27A79711F6a8945f1B9Dec2Ae9E15cc9E5" /></td></tr>
          <tr><td>Adapter · WETH</td><td><Addr a="0xc04a84794782a3F5e6dB1226b68cF46934aE4994" /></td></tr>
          <tr><td>Fixed test mark</td><td><Addr a="0x11fbbDC9954A2Ca6C1eA9E5786d3725d7803dC8D" /></td></tr>
          <tr><td><b>Property market</b> vault (demo)</td><td><Addr a="0xf507640a7bcb17b696c9199b34e93384b9fa5136" /></td></tr>
          <tr><td>Appraisal hook (demo)</td><td><Addr a="0xaB8E64c7087A232c24658726AD3Bc363Ed6AEAC0" /></td></tr>
        </tbody>
      </table></div>
      <h2>Base mainnet</h2>
      <div className="overflow-x-auto"><table className={TABLE}>
        <thead><tr><th>Contract</th><th>Address</th></tr></thead>
        <tbody>
          <tr><td><b>AIAttribution v3</b> — attestation ledger, holds no funds</td><td><Addr a="0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421" /></td></tr>
          <tr><td>ERC-8004 identity registry (third party)</td><td><Addr a="0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" /></td></tr>
        </tbody>
      </table></div>
      <Note k="Same address, different chains">The Robinhood lifecycle module and the Base AIAttribution contract share an address because they came from the same deployer nonce on different chains. They are unrelated contracts.</Note>
    </>
  )
}

// ── nav + content registry ───────────────────────────────────────────────────
const GROUPS: { group: string; items: { id: string; label: string }[] }[] = [
  { group: 'Start here', items: [{ id: 'overview', label: 'Overview' }] },
  { group: 'Products', items: [
    { id: 'markets', label: 'Markets' },
    { id: 'rwa', label: 'Property market (demo)' },
    { id: 'swap', label: 'Swap' },
    { id: 'earn', label: 'Treasury yield' },
    { id: 'card', label: 'Card' },
    { id: 'agents', label: 'Agent payments' },
  ] },
  { group: 'Trust', items: [{ id: 'risks', label: 'Risks' }, { id: 'security', label: 'Security and custody' }] },
  { group: 'Reference', items: [{ id: 'contracts', label: 'Contracts' }] },
]

const CONTENT: Record<string, (p: { nav: Nav }) => ReactNode> = {
  overview: Overview, markets: Markets, rwa: Rwa, swap: Swap, earn: Earn, card: Card, agents: Agents,
  risks: Risks, security: Security, contracts: Contracts,
}

const PROSE = 'min-w-0 max-w-[820px] px-12 pt-10 pb-24 max-[880px]:px-4 max-[880px]:pt-6 text-ink ' +
  '[&_h1]:text-[clamp(30px,3.6vw,44px)] [&_h1]:font-semibold [&_h1]:tracking-[-0.035em] [&_h1]:leading-[1.05] [&_h1]:mt-3 [&_h1]:mb-0 ' +
  '[&_h2]:text-[20px] [&_h2]:font-semibold [&_h2]:tracking-[-0.02em] [&_h2]:mt-9 [&_h2]:mb-2.5 ' +
  '[&_p]:my-2.5 [&_p]:leading-[1.62] [&_p]:text-[15.5px] [&_p]:text-[var(--mw-ink-2)] ' +
  '[&_a]:font-semibold [&_a]:no-underline hover:[&_a]:underline [&_a]:text-[var(--mw-peri-deep)] ' +
  '[&_code]:font-geist-mono [&_code]:text-[0.86em] [&_code]:rounded-md [&_code]:px-1.5 [&_code]:py-px [&_code]:bg-[var(--mw-well)] ' +
  '[&_ul]:my-3 [&_ul]:pl-0 [&_ul]:list-none [&_li]:relative [&_li]:pl-5 [&_li]:py-1 [&_li]:leading-[1.55] [&_li]:text-[15px] [&_li]:text-[var(--mw-ink-2)] ' +
  "[&_li]:before:content-[''] [&_li]:before:absolute [&_li]:before:left-1 [&_li]:before:top-[13px] [&_li]:before:w-1.5 [&_li]:before:h-1.5 [&_li]:before:rounded-full [&_li]:before:bg-[var(--mw-btn)]"

export default function DocsPage() {
  const [active, setActive] = useState('overview')
  const nav: Nav = (id) => { if (CONTENT[id]) { setActive(id); window.scrollTo(0, 0) } }
  const Section = CONTENT[active] ?? Overview

  return (
    <div className="font-geist min-h-screen overflow-x-clip antialiased" style={{ background: 'var(--mw-ground)', color: 'var(--mw-ink)' }}>
      <V2Nav />
      <div className="grid grid-cols-[248px_minmax(0,1fr)] max-w-[1200px] mx-auto max-[880px]:grid-cols-1">
        <aside className="px-4 pt-8 pb-10 sticky top-[64px] self-start max-[880px]:static max-[880px]:pt-4 max-[880px]:pb-0">
          <nav className="flex flex-col gap-4 max-[880px]:flex-row max-[880px]:gap-1 max-[880px]:overflow-x-auto max-[880px]:p-1 max-[880px]:rounded-[12px] max-[880px]:[background:var(--mw-well)] max-[880px]:[box-shadow:var(--mw-inset)] [scrollbar-width:none]">
            {GROUPS.map((g) => (
              <div key={g.group} className="max-[880px]:contents">
                <div className="mb-1.5 px-2 text-[11px] uppercase tracking-[0.08em] font-semibold text-ink-soft max-[880px]:hidden">{g.group}</div>
                <div className="flex flex-col gap-0.5 rounded-[14px] p-1 max-[880px]:contents" style={{ background: 'var(--mw-well)', boxShadow: 'var(--mw-inset)' }}>
                  {g.items.map((it) => {
                    const on = active === it.id
                    return (
                      <button
                        key={it.id}
                        onClick={() => nav(it.id)}
                        aria-current={on ? 'page' : undefined}
                        className="text-left text-[14px] font-medium px-3 py-2 rounded-[10px] border-0 cursor-pointer whitespace-nowrap shrink-0"
                        style={on ? { background: '#fff', boxShadow: 'var(--mw-raise-sm)', color: 'var(--mw-ink)' } : { background: 'transparent', color: 'var(--mw-ink-2)' }}
                      >
                        {it.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>
        </aside>
        <main className={PROSE}>
          <Section nav={nav} />
        </main>
      </div>
    </div>
  )
}
