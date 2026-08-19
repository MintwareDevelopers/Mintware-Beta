import type { Metadata } from 'next'
import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { MwFooter } from '@/components/web2/MwFooter'

// =============================================================================
// /risk-disclosures — the document doing most of the real protective work.
//
// ⚠ LEGAL DRAFT — NOT REVIEWED BY COUNSEL. Categories/approach informed by
// WLFI's public Risk Disclosures (43-item precedent for a comparable,
// heavily-scrutinized crypto platform) — but the actual risk items below are
// specific to Mintware's real product surface and CURRENT status, verified
// against the app's own honesty conventions (the same "in testing on Base
// Sepolia," "nothing here is externally audited" language already used
// throughout /docs and every vault/payments page — this document should
// never say anything those pages contradict, and vice versa).
//
// KEEP THIS IN SYNC: if a surface goes from testnet to mainnet/audited, this
// page's status framing for that surface must update in the same PR (the
// repo's own reconcile-on-change rule, applied to legal copy).
// =============================================================================

export const metadata: Metadata = {
  title: 'Risk Disclosures | Mintware',
  description: 'The real risks of using Mintware — Attribution, vaults, and the payments surface — stated plainly.',
}

const h1 = 'font-atx-display font-semibold text-ink tracking-[-0.03em] leading-[1.05] text-[clamp(1.9rem,3.6vw,2.7rem)] mb-2 [text-wrap:balance]'
const h2 = 'font-atx-display font-semibold text-ink tracking-[-0.01em] text-[19px] mt-10 mb-2.5 pt-6 border-t border-hair scroll-mt-24'
const p = 'text-[14.5px] leading-[1.65] text-ink-mid mb-3 max-w-[76ch]'
const wrap = 'mx-auto max-w-[880px] px-6 max-[800px]:px-4 py-16'

function Risk({ t, children }: { t: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-hair border-l-[3px] border-l-coral2-deep bg-ground-cool px-[18px] py-4 my-3">
      <div className="font-atx-display font-semibold text-[13.5px] text-ink mb-1">{t}</div>
      <p className="text-[13.5px] leading-[1.55] text-ink-mid m-0">{children}</p>
    </div>
  )
}

const SECTIONS = [
  ['general', '1. Read this first'],
  ['market', '2. Digital-asset & market risk'],
  ['contract', '3. Smart-contract & protocol risk'],
  ['attribution', '4. Attribution score risk'],
  ['vaults', '5. Vault & liquidity-provision risk'],
  ['payments', '6. Payments, agent & x402 risk'],
  ['referrals', '7. Referral & rewards risk'],
  ['orgs', '8. Org-tenancy risk'],
  ['regulatory', '9. Regulatory & legal risk'],
  ['platform', '10. Platform & operational risk'],
] as const

export default function RiskDisclosuresPage() {
  return (
    <div className="min-h-screen font-atx-display bg-white text-ink overflow-x-clip">
      <V2Nav />
      <div className={wrap}>
        <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep mb-3">Legal</div>
        <h1 className={h1}>Risk Disclosures</h1>
        <p className="text-[13px] text-ink-soft mb-8">Last updated: [FILL IN DATE] · Incorporated into our <Link href="/terms" className="text-peri-deep">Terms of Service</Link> by reference</p>

        <div className="soft-card p-5 mb-10">
          <div className="text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-soft mb-2">On this page</div>
          <nav className="grid grid-cols-2 max-[560px]:grid-cols-1 gap-x-6 gap-y-1">
            {SECTIONS.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="text-[13px] text-peri-deep no-underline hover:underline py-0.5">{label}</a>
            ))}
          </nav>
        </div>

        <h2 id="general" className={h2}>1. Read this first</h2>
        <p className={p}>
          Using Mintware can result in the total, irreversible loss of your funds. This document
          describes the risks we believe are most relevant to our actual product, stated as plainly
          as we can. It is not exhaustive — digital-asset technology carries risks that cannot be
          fully anticipated. <b>Do not use any feature of the Services with funds you cannot afford to
          lose, and never rely on Mintware for financial, legal, or tax advice.</b>
        </p>

        <h2 id="market" className={h2}>2. Digital-asset & market risk</h2>
        <Risk t="Extreme volatility">Digital-asset prices can move sharply and unpredictably, including to zero. Historical performance of any asset or vault is not indicative of future results.</Risk>
        <Risk t="Irreversibility">Blockchain transactions generally cannot be reversed, cancelled, or refunded once confirmed. A mistaken address, amount, or approval is typically unrecoverable.</Risk>
        <Risk t="No deposit insurance">Nothing on the Services is insured by the FDIC, SIPC, or any government or private insurer. Loss of funds is your loss alone.</Risk>
        <Risk t="Private key & custody risk">If you self-custody, you are solely responsible for securing your private keys and seed phrase. Loss of a key, or use of an embedded wallet whose recovery method you do not control, can mean permanent loss of funds. Review Privy's own security disclosures for embedded wallets.</Risk>

        <h2 id="contract" className={h2}>3. Smart-contract & protocol risk</h2>
        <Risk t="Unaudited contracts">As of this writing, no contract underlying the vaults or payments surface has completed an external security audit. Audited status, when achieved, will be stated explicitly on the relevant product page — absence of that statement means unaudited.</Risk>
        <Risk t="Testnet, not mainnet">The vault engine and payments stack currently operate on Base Sepolia and Circle Arc testnet. Testnet contracts are unproven, may contain bugs, and are not backed by real economic value regardless of any figure displayed.</Risk>
        <Risk t="Bugs & exploits">Smart contracts, however careful the engineering, can contain vulnerabilities. A bug or exploit in Mintware's contracts, or in a third-party protocol Mintware routes through (Aave, Uniswap V4), can result in loss of funds routed through it.</Risk>
        <Risk t="Upgrade & governance risk">We may pause, deprecate, or migrate contracts, including via a guardian kill-switch, at our discretion in response to a discovered vulnerability or other operational need. This can temporarily or permanently affect your ability to withdraw or use a position.</Risk>
        <Risk t="Third-party protocol dependency">The vaults route idle capital through third-party protocols (currently Aave). A failure, exploit, or parameter change in that protocol can affect vault solvency independent of any bug in Mintware's own contracts.</Risk>

        <h2 id="attribution" className={h2}>4. Attribution score risk</h2>
        <Risk t="Not a credit score, not a guarantee">Your Attribution score reflects historical, publicly observable on-chain activity as measured by our current methodology. It is not a statement about your character, trustworthiness, or future behavior, and no one — counterparty, protocol, or Mintware itself — should treat it as a guarantee of anything.</Risk>
        <Risk t="Data-provider limitations">Score computation depends on third-party data providers (Etherscan, Zerion, Nansen). Provider outages, rate limits, or incomplete indexing can produce a score that under- or over-represents actual activity at any given moment.</Risk>
        <Risk t="Residual gaming risk">While the scoring methodology includes anti-sybil and risk-penalty logic, no scoring system is immune to sophisticated manipulation. A score should be treated as one signal, never a sole basis for a material decision about a counterparty.</Risk>
        <Risk t="Methodology changes">We may change the scoring methodology, weighting, or data sources at any time, which can change your score without any change in your own on-chain behavior.</Risk>

        <h2 id="vaults" className={h2}>5. Vault & liquidity-provision risk</h2>
        <Risk t="Impermanent loss">Providing liquidity to a two-sided pool can result in a lower dollar value than simply holding the underlying assets, depending on price divergence between them.</Risk>
        <Risk t="Lock-tier & early-exit penalties">Locking a position for a reward multiplier restricts your ability to withdraw before the lock expires; early exit (where permitted) may incur a penalty.</Risk>
        <Risk t="Reward discretion">Reward rates, multipliers, and fee splits are set by Mintware and may be changed, reduced, or discontinued at any time and without obligation to compensate you for the change.</Risk>
        <Risk t="Illustrative figures">APY, TVL, or example-vault figures shown before a vault is live and funded are illustrative projections, not historical results, and should not be relied upon.</Risk>

        <h2 id="payments" className={h2}>6. Payments, agent & x402 risk</h2>
        <Risk t="Experimental, testnet-only">The Liquid Sovereign Account, card-spend, and agent x402 payment rails are experimental and currently run against testnet infrastructure (Circle Arc testnet). No real card, real settlement, or real merchant transaction should be assumed to occur through these features unless explicitly stated as live.</Risk>
        <Risk t="No settlement guarantee">Authorization of a spend (e.g. an edge-auth "approve") is not a guarantee of final on-chain settlement. A settlement can fail, be delayed, or be reversed by an underlying rail (Circle, Visa) independent of Mintware's own systems.</Risk>
        <Risk t="Agent delegation risk">Granting an autonomous agent a scoped spending permission means that agent can act within that scope without further confirmation from you. Misconfigured limits, a compromised agent, or a bug in the delegation logic can result in unintended spend up to the granted limit.</Risk>

        <h2 id="referrals" className={h2}>7. Referral & rewards risk</h2>
        <Risk t="Discretionary program">Referral rewards, campaign rewards, and any point or bonus system are discretionary incentive programs. We may modify, pause, or cancel them, or adjust eligibility retroactively to address abuse, without liability.</Risk>
        <Risk t="No entitlement">Participation does not create a contractual entitlement to any specific reward amount or schedule.</Risk>

        <h2 id="orgs" className={h2}>8. Org-tenancy risk</h2>
        <Risk t="Org-issued attestations are not verified by Mintware">If you join an organization through the Services, that organization — not Mintware — determines your role and any access it grants you. Mintware issues the underlying attestation at the org's request but does not verify the org's identity, legitimacy, or internal policies. Evaluate any organization independently before joining it or relying on membership within it.</Risk>
        <Risk t="No treasury guarantee">An organization's treasury, if and when deployed, is controlled by that organization, not Mintware. We are not responsible for how an org manages, allocates, or loses funds in its own treasury.</Risk>

        <h2 id="regulatory" className={h2}>9. Regulatory & legal risk</h2>
        <Risk t="Evolving, uncertain regulation">The regulatory treatment of digital assets, DeFi protocols, on-chain reputation systems, and agent-initiated payments is unsettled and evolving in the United States and elsewhere. A future law, regulation, or enforcement action could restrict, prohibit, or require us to materially change the Services, potentially without advance notice.</Risk>
        <Risk t="Sanctions & jurisdictional restrictions">We restrict access from certain jurisdictions and sanctioned parties (see <Link href="/terms" className="text-peri-deep">Terms of Service §2</Link>) and may expand those restrictions at any time.</Risk>
        <Risk t="No securities-law determination">Nothing in this document or elsewhere on the Services is a representation that any token, score, or product is or is not a "security" under any law. You are responsible for your own legal analysis.</Risk>

        <h2 id="platform" className={h2}>10. Platform & operational risk</h2>
        <Risk t="Early-stage company">Mintware is an early-stage company with a limited operating history. Early-stage risks — including limited resources, key-person dependency, and the possibility of discontinuing operations — apply.</Risk>
        <Risk t="No uptime guarantee">We do not guarantee the Services will be available, uninterrupted, or error-free at any given time.</Risk>
        <Risk t="Conflicts of interest">Mintware, its team, and its affiliates may hold positions in, or receive fees from, the products described on the Services, which can create incentives that are not perfectly aligned with any individual user's.</Risk>

        <p className={p + ' mt-8'}>These disclosures are incorporated by reference into our <Link href="/terms" className="text-peri-deep">Terms of Service</Link>. By using the Services you acknowledge you have read and understood them.</p>
      </div>
      <MwFooter />
    </div>
  )
}
