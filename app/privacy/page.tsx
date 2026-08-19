import type { Metadata } from 'next'
import { V2Nav } from '@/components/ui2/V2Nav'
import { MwFooter } from '@/components/web2/MwFooter'

// =============================================================================
// /privacy — Privacy Policy.
//
// ⚠ LEGAL DRAFT — NOT REVIEWED BY COUNSEL. Structurally informed by World
// Liberty Financial's public Privacy Policy (comparable crypto-platform
// precedent) — same section categories, NOT copied text. The third-party list
// below is audited against the actual codebase (grep across lib/ + app/,
// 2026-08-19), not generic boilerplate — keep it in sync when providers
// change (see the reconcile-on-change rule in CLAUDE.md).
//
// PLACEHOLDERS — search "[FILL IN]": contact emails, legal entity name,
// whether Upstash/Redis (rate limiting) or any future KYC vendor is in use
// at time of publish (currently: rate limiting is present in code but
// inactive per .claude/rules/security.md — update this policy if that changes).
// =============================================================================

export const metadata: Metadata = {
  title: 'Privacy Policy | Mintware',
  description: 'How Mintware collects, uses, and shares information across Attribution, vaults, and the payments surface.',
}

const h1 = 'font-atx-display font-semibold text-ink tracking-[-0.03em] leading-[1.05] text-[clamp(1.9rem,3.6vw,2.7rem)] mb-2 [text-wrap:balance]'
const h2 = 'font-atx-display font-semibold text-ink tracking-[-0.01em] text-[19px] mt-10 mb-2.5 pt-6 border-t border-hair scroll-mt-24'
const p = 'text-[14.5px] leading-[1.65] text-ink-mid mb-3 max-w-[76ch]'
const ul = 'text-[14.5px] leading-[1.65] text-ink-mid mb-3 max-w-[76ch] list-disc pl-5 [&>li]:mb-1.5'
const wrap = 'mx-auto max-w-[880px] px-6 max-[800px]:px-4 py-16'
const TABLE = 'w-full border-collapse text-[13px] my-4 [&_th]:border [&_th]:border-hair [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:bg-ground-cool [&_th]:font-mono [&_th]:text-[10px] [&_th]:uppercase [&_th]:text-ink-soft [&_td]:border [&_td]:border-hair [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_td]:text-ink-mid'

const SECTIONS = [
  ['overview', '1. Overview'],
  ['collect', '2. Information we collect'],
  ['use', '3. How we use information'],
  ['share', '4. How we share information'],
  ['cookies', '5. Cookies & analytics'],
  ['retention', '6. Data retention'],
  ['security', '7. Data security'],
  ['rights', '8. Your privacy rights'],
  ['ccpa', '9. California residents (CCPA/CPRA)'],
  ['children', '10. Children’s privacy'],
  ['international', '11. International data transfers'],
  ['changes', '12. Changes to this policy'],
  ['contact', '13. Contact us'],
] as const

export default function PrivacyPage() {
  return (
    <div className="min-h-screen font-atx-display bg-white text-ink overflow-x-clip">
      <V2Nav />
      <div className={wrap}>
        <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep mb-3">Legal</div>
        <h1 className={h1}>Privacy Policy</h1>
        <p className="text-[13px] text-ink-soft mb-8">Last updated: [FILL IN DATE] · Effective on posting</p>

        <div className="soft-card p-5 mb-10">
          <div className="text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-soft mb-2">On this page</div>
          <nav className="grid grid-cols-2 max-[560px]:grid-cols-1 gap-x-6 gap-y-1">
            {SECTIONS.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="text-[13px] text-peri-deep no-underline hover:underline py-0.5">{label}</a>
            ))}
          </nav>
        </div>

        <h2 id="overview" className={h2}>1. Overview</h2>
        <p className={p}>
          This Privacy Policy describes how <b>[FILL IN — Mintware legal entity name]</b>
          (&ldquo;Mintware,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) collects, uses, and shares
          information when you use mintware.finance and related services (the &ldquo;Services&rdquo;).
          Mintware is <b>non-custodial</b> — your assets never pass through our custody — but the
          Services still collect information about your wallet activity and your interaction with the
          site, described below.
        </p>

        <h2 id="collect" className={h2}>2. Information we collect</h2>
        <p className={p}><b>Wallet & on-chain information.</b> When you connect a wallet, we collect the public wallet address and, to compute your Attribution score, we read public on-chain activity associated with that address (transaction history, token holdings, liquidity positions, governance participation) via the third-party data providers listed in §4. This is public blockchain data, not information you give us directly.</p>
        <p className={p}><b>Account & authentication information.</b> Wallet connection and embedded-wallet creation are handled by our authentication provider, Privy. Depending on how you sign in, Privy may collect and share with us an email address, phone number, or social-login identifier, and manages the private keys for any embedded wallet on your behalf under its own security model.</p>
        <p className={p}><b>Information you provide directly.</b> If you create or join an organization (org tenancy), we collect the org name, the email addresses you invite, and role labels you assign. If you contact us for support, we collect what you send us.</p>
        <p className={p}><b>Usage & device information.</b> We automatically collect standard web analytics — pages visited, referring URL, browser/device type, and approximate location derived from IP address — via Vercel Web Analytics.</p>

        <h2 id="use" className={h2}>3. How we use information</h2>
        <ul className={ul}>
          <li>To compute and display your Attribution score and related reputation signals.</li>
          <li>To operate the Services — connecting your wallet, showing your positions, processing referrals and org invitations.</li>
          <li>To detect fraud, sybil behavior, and sanctions exposure (see §4 — Chainalysis).</li>
          <li>To communicate with you about the Services, including transactional notices and, if you opt in, product updates.</li>
          <li>To improve the Services through aggregated, de-identified usage analysis.</li>
          <li>To comply with legal obligations and enforce our <a href="/terms" className="text-peri-deep">Terms of Service</a>.</li>
        </ul>
        <p className={p}>We do not sell your personal information, and we do not use it to make automated decisions that produce legal or similarly significant effects about you without a human in the loop.</p>

        <h2 id="share" className={h2}>4. How we share information</h2>
        <p className={p}>We share information with the following categories of third parties, each processing it under their own terms:</p>
        <div className="overflow-x-auto"><table className={TABLE}>
          <thead><tr><th>Provider</th><th>What it processes</th><th>Purpose</th></tr></thead>
          <tbody>
            <tr><td>Privy</td><td>Email/phone/social identifier, wallet keys (embedded wallets)</td><td>Authentication & wallet management</td></tr>
            <tr><td>Etherscan, Zerion, Nansen</td><td>Public wallet address, on-chain activity</td><td>Attribution score computation</td></tr>
            <tr><td>Chainalysis</td><td>Public wallet address</td><td>Sanctions-list screening</td></tr>
            <tr><td>LI.FI</td><td>Wallet address, swap parameters</td><td>Cross-chain swap routing</td></tr>
            <tr><td>Circle, Visa</td><td>Payment/settlement data (payments surface only, currently in testing)</td><td>Stablecoin settlement, card rails</td></tr>
            <tr><td>Vercel Web Analytics</td><td>Device/browser data, approximate location, page views</td><td>Site analytics</td></tr>
            <tr><td>Supabase</td><td>All of the above, as our database host</td><td>Data storage & infrastructure</td></tr>
          </tbody>
        </table></div>
        <p className={p}>We may also disclose information if required by law, subpoena, or legal process, or to protect the rights, property, or safety of Mintware, our users, or the public. In a merger, acquisition, or asset sale, information may be transferred as part of that transaction.</p>

        <h2 id="cookies" className={h2}>5. Cookies & analytics</h2>
        <p className={p}>We use strictly-necessary cookies to operate the Services (e.g. session state) and analytics tooling (Vercel Web Analytics) to understand usage. We do not use third-party advertising cookies. Where required by law, we will present a cookie consent mechanism and honor Global Privacy Control (GPC) / Do Not Track signals as legally applicable.</p>

        <h2 id="retention" className={h2}>6. Data retention</h2>
        <p className={p}>We retain information for as long as necessary to provide the Services, comply with legal obligations, resolve disputes, and enforce our agreements. Public on-chain data is, by its nature, permanently recorded on the relevant blockchain independent of anything we retain.</p>

        <h2 id="security" className={h2}>7. Data security</h2>
        <p className={p}>We use reasonable administrative, technical, and physical safeguards designed to protect information. No method of transmission or storage is completely secure, and we cannot guarantee absolute security. You are responsible for securing your own wallet credentials — we never have access to a self-custodied wallet's private keys.</p>

        <h2 id="rights" className={h2}>8. Your privacy rights</h2>
        <p className={p}>Depending on your location, you may have the right to access, correct, delete, or export the personal information we hold about you, or to object to or restrict certain processing. To exercise these rights, contact us at <b>[FILL IN — privacy@mintware.finance]</b>. Because much of the information underlying an Attribution score is independently verifiable public blockchain data, some rights (e.g., deletion) may not extend to that on-chain data itself.</p>

        <h2 id="ccpa" className={h2}>9. California residents (CCPA/CPRA)</h2>
        <p className={p}>If you are a California resident, you have the right to know what personal information we collect, request deletion, correct inaccurate information, and opt out of the "sale" or "sharing" of personal information as those terms are defined under the CCPA/CPRA. <b>We do not sell or share personal information for cross-context behavioral advertising.</b> Submit a verifiable request via <b>[FILL IN — privacy@mintware.finance]</b>. We will not discriminate against you for exercising these rights.</p>

        <h2 id="children" className={h2}>10. Children&rsquo;s privacy</h2>
        <p className={p}>The Services are not directed to anyone under 18, and we do not knowingly collect personal information from children. If we learn we have collected information from a child, we will delete it.</p>

        <h2 id="international" className={h2}>11. International data transfers</h2>
        <p className={p}>We and our service providers may process information in the United States and other countries. Where required, we use appropriate safeguards (such as standard contractual clauses) for transfers of personal information from the EEA, UK, or Switzerland.</p>

        <h2 id="changes" className={h2}>12. Changes to this policy</h2>
        <p className={p}>We may update this Privacy Policy from time to time. Material changes will be reflected by an updated &ldquo;Last updated&rdquo; date, and, where required by law, we will provide additional notice.</p>

        <h2 id="contact" className={h2}>13. Contact us</h2>
        <p className={p}>Questions about this Privacy Policy: <b>[FILL IN — privacy@mintware.finance]</b></p>
      </div>
      <MwFooter />
    </div>
  )
}
