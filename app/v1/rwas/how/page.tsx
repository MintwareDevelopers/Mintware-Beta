import Link from 'next/link'
export default function RwaHowPage() {
  return <article className="max-w-[900px] mx-auto px-8 py-12 text-ink">
    <h1 className="font-geist text-3xl font-semibold">How an owned RWA pool works</h1>
    <p className="mt-6">Qualified holders contribute property tokens and USDC to the MarketEngine. Non-transferable shares account for their proportional holdings. The engine owns a direct Uniswap v4 position and holds idle assets through its adapters.</p>
    <p className="mt-4">A single hook checks issuer permissions and an observed appraisal. Trades use Universal Router and Permit2 with the verified PermissionsAdapter. Only trusted wrappers may report a trader; recipients must also satisfy the property token’s own transfer restrictions.</p>
    <p className="mt-4">The appraisal band constrains trading. Stale observations or a guardian pause stop new trades. Full in-kind exits remain available without a mark; incomplete delivery preserves the undelivered claim and needs a valid grace-period mark.</p>
    <p className="mt-4">Testnet only. Tokens have no monetary value. The composition is unaudited.</p>
    <Link className="inline-block mt-6 text-peri-deep" href="/v1/rwas">View the unit →</Link>
  </article>
}
