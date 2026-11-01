import Link from 'next/link'
import { FlowDiagram } from '@/components/ui2/FlowDiagram'
import { DocHeader, DocTable, H2, Note, Sources } from './DocPrimitives'
import styles from '@/app/docs/docs.module.css'

export function Overview() {
  return <>
    <DocHeader title="One engine per asset." lead="The engine manages capital. The pool makes a market. A hook sets pool rules where we create the pool."
      status="MarketEngine deployments are testnet demonstrations with test tokens. Mintware’s contracts and composition are unaudited." />
    <p>Tokenization makes an asset divisible; it does not supply buyers, sellers or liquidity. Mintware gives each curated asset market its own engine, tied to one Uniswap v4 pool. Liquidity providers contribute either or both assets and receive shares in that engine’s portfolio.</p>
    <figure className={styles.figure} aria-label="Capital flow from liquidity provider through the engine to pool and adapters">
      <FlowDiagram steps={[
        { label: 'You supply tokens', sub: 'One or both underlying assets, with a minimum share amount.' },
        { label: 'Engine issues shares', sub: 'A proportional claim on this market’s marked assets.' },
        { label: 'Capital has two uses', sub: 'A resting pool position, or idle assets held directly and in adapters.' },
      ]} />
      <figcaption>Withdrawals reverse the capital flow: underlying tokens return to your chosen recipient, and delivered value consumes shares.</figcaption>
    </figure>
    <H2 id="two-pool-kinds">Two kinds of pool</H2>
    <DocTable caption="Same capital model, different pool rules" headers={['Market', 'Engine', 'Pool rules']} rows={[
      ['Existing pools created by others', <code key="e">MintwareMarketEngine</code>, 'Only hookless Uniswap v4 pools are accepted by this wrapper. We cannot add our hook to an existing pool; the engine controls its own position, not everyone’s trades.'],
      ['Pools we create for RWAs', <code key="e">MintwareOwnedPoolMarketEngine</code>, 'Our appraisal and permission hook is part of the pool key from initialization. The pool uses Uniswap Permissioned Pools infrastructure.'],
    ]} />
    <p>The <strong>engine</strong> holds the claim ledger, values assets, issues shares, uses idle adapters, deploys liquidity and processes withdrawals. The <strong>hook</strong> is called by Uniswap’s PoolManager to enforce rules on pool operations. The owned RWA hook also supplies the engine’s appraisal mark.</p>
    <p>Each engine has its own assets and share supply. There is no shared engine balance or cross-market borrowing in this model. Markets can still share dependencies and risks, including tokens, operators and Uniswap infrastructure.</p>
    <H2 id="today-and-roadmap">Liquidity today; collateral and credit on the roadmap</H2>
    <p>The implemented engine manages liquidity and in-kind claims. Using those claims as collateral, lending against an asset, and credit issuance are roadmap work. They are not enabled by owning today’s market shares.</p>
    <DocTable caption="Recorded market deployments" headers={['Market', 'Network', 'Current setup']} rows={[
      ['tUSDG / tPONS', 'Robinhood Chain testnet', 'Hookless pool, fixed test mark, idle-custody adapters.'],
      ['USDC / WETH', 'Base Sepolia', 'Hookless pool, fixed test mark, idle-custody adapters.'],
      ['Property unit / USDC', 'Base Sepolia', 'Owned hooked pool, dated appraisal mark, idle-custody adapters. Trading is recorded as disabled pending permissioned routing.'],
    ]} />
    <p>Addresses come from the <Link href="/docs/contracts">current deployment reference</Link>. The app’s <Link href="/app/markets">Markets</Link> page separates curated engines from its pool discovery feed. Discovery scores rank candidates; they do not certify safety or create an engine.</p>
    <Note title="Choose your next step">
      Follow the <Link href="/docs/markets">engine lifecycle</Link>, inspect the <Link href="/docs/architecture">contract map</Link>, or start with the <Link href="/docs/integrating">integration guide</Link>. Read <Link href="/docs/risks">Risks</Link> before providing liquidity. Definitions are in the <Link href="/docs/glossary">glossary</Link>.
    </Note>
    <Sources files={['contracts-v4/src/vaults/MintwareMarketEngineCore.sol', 'contracts-v4/src/vaults/MintwareMarketEngine.sol', 'contracts-v4/src/vaults/MintwareOwnedPoolMarketEngine.sol', 'config/deployments.json', 'app/api/gateway/discover/route.ts']} />
  </>
}
