import type { Metadata } from 'next'
import Link from 'next/link'
import { V2Nav } from '@/components/ui2/V2Nav'
import { MwFooter } from '@/components/web2/MwFooter'

// =============================================================================
// /terms — Terms of Service.
//
// ⚠ LEGAL DRAFT — NOT REVIEWED BY COUNSEL. Structurally informed by publicly
// available precedent from comparable, heavily-scrutinized crypto platforms
// (World Liberty Financial's ToS, GetTrumpMemes' Terms) — same clause
// categories (arbitration, class-action waiver, warranty disclaimer, liability
// cap, no-fiduciary-duty, geo-restriction), NOT copied text. Content is
// specific to Mintware's actual product surface and current honest status
// (Attribution live on Base mainnet; vaults/payments in testing, unaudited).
//
// Entity: Mintware LLC. State of formation was not specified when this was
// filled in — DEFAULTED TO DELAWARE (matches both precedent docs) throughout
// this document; confirm against actual incorporation and correct if wrong.
//
// ⚠ legal@mintware.finance is used throughout as the contact address, but per
// the user (2026-08-19) THIS INBOX DOES NOT YET EXIST. It must be created and
// monitored before this document is meaningfully enforceable — a notice
// clause pointing at a dead inbox is a real gap, not a formality.
//
// Liability cap set to $500 USD (matches GetTrumpMemes' figure) per user
// direction. Arbitration administrator defaulted to AAA (matches WLFI).
// =============================================================================

export const metadata: Metadata = {
  title: 'Terms of Service | Mintware',
  description: 'The terms governing use of Mintware — Attribution, vaults, and the payments surface.',
}

const h1 = 'font-atx-display font-semibold text-ink tracking-[-0.03em] leading-[1.05] text-[clamp(1.9rem,3.6vw,2.7rem)] mb-2 [text-wrap:balance]'
const h2 = 'font-atx-display font-semibold text-ink tracking-[-0.01em] text-[19px] mt-10 mb-2.5 pt-6 border-t border-hair scroll-mt-24'
const h3 = 'font-atx-display font-semibold text-ink text-[15px] mt-5 mb-1.5'
const p = 'text-[14.5px] leading-[1.65] text-ink-mid mb-3 max-w-[76ch]'
const ul = 'text-[14.5px] leading-[1.65] text-ink-mid mb-3 max-w-[76ch] list-disc pl-5 [&>li]:mb-1.5'
const wrap = 'mx-auto max-w-[880px] px-6 max-[800px]:px-4 py-16'

const SECTIONS = [
  ['agreement', '1. Agreement to these Terms'],
  ['eligibility', '2. Eligibility & geographic restrictions'],
  ['services', '3. The services'],
  ['not-advice', '4. Not investment advice; not a security'],
  ['third-party', '5. Third-party services & protocols'],
  ['prohibited', '6. Prohibited conduct'],
  ['fiduciary', '7. No fiduciary duty'],
  ['ip', '8. Intellectual property'],
  ['risks', '9. Risks'],
  ['warranties', '10. Disclaimer of warranties'],
  ['liability', '11. Limitation of liability'],
  ['indemnification', '12. Indemnification'],
  ['disputes', '13. Dispute resolution — binding arbitration'],
  ['governing-law', '14. Governing law & venue'],
  ['termination', '15. Termination'],
  ['changes', '16. Changes to these terms'],
  ['misc', '17. Miscellaneous'],
  ['contact', '18. Contact'],
] as const

export default function TermsPage() {
  return (
    <div className="min-h-screen font-atx-display bg-white text-ink overflow-x-clip">
      <V2Nav />
      <div className={wrap}>
        <div className="text-[12px] uppercase tracking-[0.12em] font-semibold text-peri-deep mb-3">Legal</div>
        <h1 className={h1}>Terms of Service</h1>
        <p className="text-[13px] text-ink-soft mb-8">Last updated: August 19, 2026 · Effective on posting</p>

        <div className="soft-card p-5 mb-10">
          <div className="text-[11px] uppercase tracking-[0.1em] font-semibold text-ink-soft mb-2">On this page</div>
          <nav className="grid grid-cols-2 max-[560px]:grid-cols-1 gap-x-6 gap-y-1">
            {SECTIONS.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="text-[13px] text-peri-deep no-underline hover:underline py-0.5">{label}</a>
            ))}
          </nav>
        </div>

        <p className={p}>
          These Terms of Service (&ldquo;<b>Terms</b>&rdquo;) govern your access to and use of the
          website, applications, and services operated by <b>Mintware LLC, a Delaware limited
          liability company</b> (&ldquo;<b>Mintware</b>,&rdquo;
          &ldquo;<b>we</b>,&rdquo; &ldquo;<b>us</b>&rdquo;), including mintware.finance and any
          associated app, API, or interface (collectively, the &ldquo;<b>Services</b>&rdquo;).
        </p>
        <p className={p}>
          By accessing or using the Services, you agree to be bound by these Terms and our{' '}
          <Link href="/privacy" className="text-peri-deep">Privacy Policy</Link> and{' '}
          <Link href="/risk-disclosures" className="text-peri-deep">Risk Disclosures</Link>, each
          incorporated by reference. If you do not agree, do not use the Services.
        </p>

        <h2 id="agreement" className={h2}>1. Agreement to these Terms</h2>
        <p className={p}>
          We may modify these Terms at any time, effective upon posting to this page. Your continued
          use of the Services after a change constitutes acceptance. It is your responsibility to
          review these Terms periodically. We may restrict, suspend, or terminate access to the
          Services, in whole or in part, for any jurisdiction, at our sole discretion and without notice.
        </p>

        <h2 id="eligibility" className={h2}>2. Eligibility & geographic restrictions</h2>
        <p className={p}>By using the Services, you represent and warrant that:</p>
        <ul className={ul}>
          <li>You are at least 18 years old and have the legal capacity to enter into a binding contract.</li>
          <li>You are not located in, organized under the laws of, or a resident of any jurisdiction subject to U.S. sanctions or comprehensive embargo (including but not limited to Cuba, Iran, North Korea, Syria, and the Crimea, Donetsk, and Luhansk regions), and you are not listed on any U.S. Treasury OFAC Specially Designated Nationals list or equivalent restricted-party list.</li>
          <li>Your use of the Services complies with all laws applicable to you in your jurisdiction, including any restrictions on digital-asset transactions.</li>
          <li>You will not use a VPN, proxy, or other method to circumvent geographic restrictions we apply.</li>
          <li>You possess the financial and technical sophistication necessary to evaluate the risks of the Services, described in <Link href="/risk-disclosures" className="text-peri-deep">Risk Disclosures</Link>.</li>
        </ul>
        <p className={p}>We may screen wallet addresses against sanctions and restricted-party lists and deny or restrict access accordingly, at our sole discretion.</p>

        <h2 id="services" className={h2}>3. The services</h2>
        <p className={p}>Mintware provides a non-custodial interface to on-chain products across three areas. <b>We do not take custody of your assets at any point</b> — you interact with smart contracts directly through your own wallet.</p>
        <ul className={ul}>
          <li><b>Attribution</b> — an on-chain reputation score computed from public wallet activity, published via offchain EAS attestations and an on-chain contract on Base mainnet.</li>
          <li><b>Vaults</b> — reputation-adjacent liquidity provision on Uniswap V4. <b>Currently in testing on Base Sepolia, unaudited, and not open to real value.</b> Nothing on this platform should be read as an invitation to deposit real funds until we state otherwise in writing.</li>
          <li><b>Payments</b> — a yield-bearing spend account and agent payment rails (including HTTP&nbsp;402-based machine payments). <b>Currently in testing, unaudited, gated behind required configuration, and not generally available.</b></li>
        </ul>
        <p className={p}>Features described anywhere on the Services, including marketing pages, may be aspirational, in development, or gated behind a status we disclose honestly — we label live, testing, and blueprint-stage features distinctly, and you should rely only on the status label current at the time you use a feature, not on prior representations.</p>

        <h2 id="not-advice" className={h2}>4. Not investment advice; not a security</h2>
        <p className={p}>
          Nothing on the Services constitutes investment, financial, legal, or tax advice, or a
          recommendation or solicitation to buy, sell, or hold any asset. Your Attribution score is a
          descriptive measure of historical on-chain activity — <b>it is not a credit score, not a
          statement of creditworthiness, and not a prediction or guarantee of future performance,
          reliability, or trustworthiness of any address.</b> Any yield, reward, or return figures
          displayed are illustrative or historical only and are not a promise of future results. You
          are solely responsible for evaluating the merits and risks of any transaction you undertake.
        </p>

        <h2 id="third-party" className={h2}>5. Third-party services & protocols</h2>
        <p className={p}>The Services integrate or rely on independent third-party providers, including without limitation:</p>
        <ul className={ul}>
          <li><b>Privy</b> — wallet authentication and embedded-wallet key management.</li>
          <li><b>Etherscan, Zerion, and Nansen</b> — on-chain activity data used to compute Attribution scores.</li>
          <li><b>Chainalysis</b> — sanctions-list screening.</li>
          <li><b>LI.FI</b> — cross-chain swap routing and execution.</li>
          <li><b>Aave and Uniswap</b> (and their respective smart contracts) — underlying liquidity and lending protocols the vaults route capital through.</li>
          <li><b>Circle and Visa</b> — stablecoin issuance and card settlement, where applicable to the payments surface.</li>
        </ul>
        <p className={p}>
          Each provider operates independently of Mintware, under its own terms and privacy practices,
          which you should review separately. We do not control, and are not responsible for, the
          availability, accuracy, security, or conduct of any third-party provider or protocol. Your
          use of any third-party service through the Services is at your own risk.
        </p>

        <h2 id="prohibited" className={h2}>6. Prohibited conduct</h2>
        <p className={p}>You agree not to use the Services to:</p>
        <ul className={ul}>
          <li>Engage in fraud, market manipulation, wash trading, or any deceptive trading practice, including artificially inflating an Attribution score or referral tree.</li>
          <li>Launder money, finance terrorism, or violate any applicable sanctions or export-control law.</li>
          <li>Introduce malware, attempt unauthorized access to the Services or any connected system, or interfere with the Services' normal operation.</li>
          <li>Impersonate any person or entity, or misrepresent your affiliation with any person or entity, including any organization onboarded under §3's org-tenancy feature.</li>
          <li>Infringe any intellectual property or other right of Mintware or a third party.</li>
          <li>Circumvent any access restriction, rate limit, or eligibility check we apply.</li>
        </ul>
        <p className={p}>We may investigate suspected violations and take any action we deem appropriate, including restricting access, without prior notice.</p>

        <h2 id="fiduciary" className={h2}>7. No fiduciary duty</h2>
        <p className={p}>
          The Services are provided on a non-discretionary, informational basis. You acknowledge and
          agree that Mintware owes you no fiduciary duty, and nothing in these Terms or your use of
          the Services creates a partnership, joint venture, agency, employment, or fiduciary
          relationship between you and Mintware.
        </p>

        <h2 id="ip" className={h2}>8. Intellectual property</h2>
        <p className={p}>
          Mintware retains all right, title, and interest in the Services, including all software,
          designs, text, and trademarks, except for open-source components licensed separately and any
          on-chain contract code we have made available under an open-source license. We grant you a
          limited, revocable, non-exclusive, non-transferable license to access and use the Services
          for their intended purpose. You may not copy, modify, reverse-engineer, or create derivative
          works of the Services except as expressly permitted by an applicable open-source license.
        </p>

        <h2 id="risks" className={h2}>9. Risks</h2>
        <p className={p}>
          Use of the Services involves significant risk, including total loss of funds. Before using
          any feature of the Services, read our{' '}
          <Link href="/risk-disclosures" className="text-peri-deep">Risk Disclosures</Link>, which are
          incorporated into these Terms by reference. By using the Services you acknowledge you have
          read, understood, and accepted those risks.
        </p>

        <h2 id="warranties" className={h2}>10. Disclaimer of warranties</h2>
        <p className={p}>
          THE SERVICES ARE PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE,&rdquo; WITHOUT
          WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION WARRANTIES OF
          MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, ACCURACY, OR
          UNINTERRUPTED OR ERROR-FREE OPERATION. WE DO NOT WARRANT THAT ANY SMART CONTRACT,
          ATTRIBUTION SCORE, OR THIRD-PARTY INTEGRATION IS FREE OF BUGS, VULNERABILITIES, OR ERRORS.
        </p>

        <h2 id="liability" className={h2}>11. Limitation of liability</h2>
        <p className={p}>
          TO THE FULLEST EXTENT PERMITTED BY LAW, MINTWARE AND ITS AFFILIATES, OFFICERS, EMPLOYEES,
          AND SERVICE PROVIDERS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
          CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, DATA, OR DIGITAL ASSETS, ARISING
          FROM YOUR USE OF THE SERVICES, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. OUR
          AGGREGATE LIABILITY FOR ANY CLAIM ARISING OUT OF OR RELATING TO THE SERVICES WILL NOT EXCEED
          THE GREATER OF (A) $500 USD OR (B) THE AMOUNT YOU PAID TO MINTWARE, IF ANY,
          IN THE 12 MONTHS PRECEDING THE CLAIM. Some jurisdictions do not allow the exclusion of
          certain warranties or the limitation of certain damages; in such jurisdictions, our liability
          is limited to the greatest extent permitted by law.
        </p>

        <h2 id="indemnification" className={h2}>12. Indemnification</h2>
        <p className={p}>
          You agree to indemnify, defend, and hold harmless Mintware and its affiliates, officers,
          employees, and service providers from any claim, loss, liability, or expense (including
          reasonable attorneys&rsquo; fees) arising from your use of the Services, your violation of
          these Terms, or your violation of any right of a third party.
        </p>

        <h2 id="disputes" className={h2}>13. Dispute resolution — binding arbitration</h2>
        <p className={p}>
          <b>Please read this section carefully — it affects your legal rights, including your right
          to file a lawsuit in court.</b>
        </p>
        <h3 className={h3}>Informal resolution first</h3>
        <p className={p}>Before filing a claim, you agree to send written notice of the dispute to legal@mintware.finance and attempt in good faith to resolve it informally for at least 30 days.</p>
        <h3 className={h3}>Binding individual arbitration</h3>
        <p className={p}>
          Any dispute not resolved informally will be settled by binding arbitration administered by
          the American Arbitration Association (&ldquo;AAA&rdquo;) under its rules then in effect,
          rather than in court, except that either party may bring an individual claim in small-claims
          court. The arbitration will be conducted in the State of Delaware, and the Federal
          Arbitration Act governs the interpretation and enforcement of this arbitration provision.
        </p>
        <h3 className={h3}>Class action waiver</h3>
        <p className={p}>
          <b>You and Mintware agree that any dispute resolution proceeding will be conducted only on an
          individual basis and not as a class, consolidated, or representative action.</b> If this
          class-action waiver is found unenforceable as to a particular claim, that claim (and only
          that claim) may proceed in court, and all other claims remain subject to arbitration.
        </p>
        <h3 className={h3}>Opt-out</h3>
        <p className={p}>You may opt out of this arbitration provision by sending written notice to legal@mintware.finance within 30 days of first accepting these Terms.</p>

        <h2 id="governing-law" className={h2}>14. Governing law & venue</h2>
        <p className={p}>
          These Terms are governed by the laws of the State of Delaware, without regard to its
          conflict-of-laws principles. For any dispute not subject to arbitration, you and Mintware
          consent to the exclusive jurisdiction of the state and federal courts located in the State
          of Delaware.
        </p>

        <h2 id="termination" className={h2}>15. Termination</h2>
        <p className={p}>
          We may suspend or terminate your access to the Services at any time, for any reason, without
          notice. Sections that by their nature should survive termination — including Intellectual
          Property, Risks, Disclaimer of Warranties, Limitation of Liability, Indemnification, Dispute
          Resolution, and Governing Law — survive.
        </p>

        <h2 id="changes" className={h2}>16. Changes to these terms</h2>
        <p className={p}>We may update these Terms at any time by posting a revised version to this page and updating the &ldquo;Last updated&rdquo; date above. Material changes may be announced through the Services.</p>

        <h2 id="misc" className={h2}>17. Miscellaneous</h2>
        <p className={p}>
          These Terms, together with the Privacy Policy and Risk Disclosures, constitute the entire
          agreement between you and Mintware regarding the Services. If any provision is held
          unenforceable, the remaining provisions remain in full force. Our failure to enforce any
          provision is not a waiver of that provision. You may not assign these Terms without our
          prior written consent; we may assign these Terms without restriction.
        </p>

        <h2 id="contact" className={h2}>18. Contact</h2>
        <p className={p}>Questions about these Terms: <b>legal@mintware.finance</b></p>
      </div>
      <MwFooter />
    </div>
  )
}
