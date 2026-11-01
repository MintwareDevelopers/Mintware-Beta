import Link from 'next/link'
import { FlowDiagram } from '@/components/ui2/FlowDiagram'
import { DocHeader, H2, Note, Sources } from './DocPrimitives'
import styles from '@/app/docs/docs.module.css'

export function EngineDocs() {
  return <>
    <DocHeader title="The engine, end to end" lead="One portfolio moves between idle assets and a liquidity band. Shares continue to represent the same portfolio through every operation."
      status="Testnet, test tokens, unaudited. This describes the current source; deployment configuration is specific to each engine." />
    <H2 id="activation">Configure once, then activate</H2>
    <p>The constructor pins an already initialized pool, its manager, quote token, non-quote mark and lifecycle module. It checks token contracts and decimals, mark asset/quote identity, aligned range ticks, and valid caps and recenter bounds. Native currency pools are not accepted; the assets must be ERC-20 tokens with at most 18 decimals.</p>
    <p>The owner calls <code>configureAdapters(address,address)</code> once. Each distinct adapter must expose the correct <code>asset()</code> and be bound to this engine through <code>vault()</code>. The owner then calls <code>activate()</code>, which requires a fresh mark, pool price within the mark-deviation limit, and readable NAV from both adapters. Activation is one-way; pause is a separate state.</p>
    <figure className={styles.figure} aria-label="Engine activation and pause state machine">
      <FlowDiagram steps={[
        { label: 'Constructed', sub: 'Pool and immutable configuration validated. No deposits yet.' },
        { label: 'Adapters bound', sub: 'Owner configures both dedicated adapters once.' },
        { label: 'Activated', sub: 'Owner activates after price and adapter checks pass.' },
      ]} />
      <div className={styles.edge}>After activation, the pause state controls new risk ↓</div>
      <div className={styles.branches}>
        <div className={styles.state}><strong>Active + unpaused</strong><p>Deposits, allocation, deployment and recenter are enabled subject to their guards.</p></div>
        <div className={styles.state}><strong>Active + paused</strong><p>Those four operations revert. Withdraw, harvest and recall remain callable, subject to their other checks.</p></div>
      </div>
      <div className={styles.edge}>Unpaused → paused: owner or guardian · Paused → unpaused: owner, or anyone after the enabled timeout</div>
      <figcaption>Pause does not deactivate the engine. It also does not promise that an exit will succeed.</figcaption>
    </figure>
    <H2 id="deposit">Deposit one or both tokens</H2>
    <p><code>deposit(uint256 amount0, uint256 amount1, uint256 minSharesOut)</code> mints to the caller. At least one amount and the minimum share floor must be nonzero. Token amounts use the decimals and order reported by the engine’s <code>token0()</code> and <code>token1()</code>.</p>
    <figure className={styles.figure} aria-label="Deposit flow">
      <FlowDiagram steps={[
        { label: 'Collect & check', sub: 'Collect pending LP fees; read a fresh mark and check spot deviation.' },
        { label: 'Receive & allocate', sub: 'Measure exact token receipt; supply each adapter up to capacity.' },
        { label: 'Value & mint', sub: 'Measure the NAV increase; enforce minimum shares and the principal cap.' },
      ]} />
    </figure>
    <p>The engine measures balances, so fee-on-transfer inputs are rejected. New funds enter the bound adapters up to <code>maxSuppliable()</code>; capacity overflow stays in the engine. An adapter deposit failure reverts the deposit rather than silently skipping that adapter.</p>
    <p>After token and adapter calls, the engine reads spot again and repeats the deviation guard. It values the before and after portfolios at that same post-callback spot and the same mark. The measured NAV increase is your contribution. This prevents an intervening pool-price move from being counted as your contribution.</p>
    <p>If supply is zero, your contribution must reach <code>minInitialContribution</code>. Initial shares equal the entire recognized post-deposit NAV normalized to 18 decimals, including recognized donations already present. Later deposits mint the contribution’s proportional share of existing NAV, rounded down. The <Link href="/docs/valuation#share-math">share math</Link> explains both cases.</p>
    <Note title="A one-token deposit is not an automatic swap">
      The deposit entry point does not zap into a balanced LP position. It creates a claim on the whole portfolio. Deployment is a separate owner action; the hookless engine can include a bounded swap in that action. The owned RWA engine disables that swap path.
    </Note>
    <H2 id="idle-assets">Allocate and recall idle assets</H2>
    <p><code>allocateIdle(uint256 amount0, uint256 amount1)</code> is owner-only and blocked while paused. It moves existing engine balances into adapters, checks capacity, and requires the engine’s measured debit to match the amount. It does not add pool liquidity.</p>
    <p><code>recallIdle(uint256 amount0, uint256 amount1)</code> is callable by anyone, including while paused. The adapters send assets to the engine, never the caller. Receipts are measured and can be smaller than requested. A reverting adapter makes this standalone recall revert; withdrawals use separate isolated recall calls to handle failures.</p>
    <p>Recorded current market adapters are custody-only: idle tokens earn no yield. The adapter interface also supports external yield sources, whose liquidity and valuation introduce additional dependencies.</p>
    <H2 id="deploy">Deploy into the resting band</H2>
    <p>The owner calls <code>deployLiquidity(amount0, amount1, zeroForOne, amountIn, minAmountOut, sqrtPriceLimitX96, minLiquidity)</code>. The first two amounts request recalls from the adapters. For hookless pools, a nonzero <code>amountIn</code> optionally swaps idle tokens before deployment. It requires a nonzero minimum output and a price limit on the correct side of spot. Actual input may be less than requested. To skip the swap, input, minimum output and price limit must all be zero.</p>
    <p>Deployment collects fees, checks a fresh mark and spot deviation, and checks NAV against the principal cap. It scales the idle budgets to the remaining position-cap room and computes liquidity for the current ticks. The result must meet a nonzero <code>minLiquidity</code>. After the pool add, it repeats spot, principal-cap and position-cap checks. If any part fails, the whole transaction—including recalls and an optional swap—reverts.</p>
    <p>Inside the band, adding liquidity needs the appropriate ratio of both tokens; outside it, range math can use one side. Unused balances remain idle. The engine owns the position directly in Uniswap’s PoolManager, rather than through a position NFT.</p>
    <H2 id="harvest">Harvest fees</H2>
    <p><code>harvest()</code> is <strong>permissionless</strong> and callable while paused. It collects accrued position fees into the engine’s token balances and emits <code>FeesCollected</code>. With no position it returns zero amounts. It does not pay the caller, mint shares or automatically redeploy the collected tokens. Deposit and withdraw also collect fees before changing shares.</p>
    <H2 id="recenter">Recenter only when due</H2>
    <p><code>recenter(uint128 minLiquidity)</code> is also <strong>permissionless</strong>, but blocked while paused. There must be an existing position and a nonzero liquidity minimum. The cooldown must have elapsed since <code>lastRecenterAt</code>, and spot must be at or beyond either edge threshold: lower tick plus <code>recenterEdgeTicks</code>, or upper tick minus it.</p>
    <p>The new band keeps the old width. Its center follows spot, rounded to tick spacing. The absolute change in the lower tick must be nonzero and no greater than <code>maxRecenterTickMove</code>. A large price jump can therefore prevent recentering rather than force an unrestricted move.</p>
    <figure className={styles.figure} aria-label="Atomic recenter flow">
      <FlowDiagram steps={[
        { label: 'Check it is due', sub: 'Cooldown, edge, mark deviation and maximum tick move.' },
        { label: 'Remove old range', sub: 'Collect fees first; re-read prices before moving liquidity.' },
        { label: 'Add new range', sub: 'Use only the removal proceeds; require minimum liquidity.' },
      ]} />
      <figcaption>Removal and re-add are atomic. A failed add restores the old position. The module checks that pool spot does not change across the move; unused proceeds remain idle.</figcaption>
    </figure>
    <p>Recenter does not mint or burn shares, swap assets, or pull extra funds from idle adapters. It repeats the mark-deviation guard after the move and updates <code>lastRecenterAt</code>.</p>
    <H2 id="withdraw">Withdraw pro-rata, in kind</H2>
    <p><code>withdraw(uint256 shares, address recipient, uint256 minAmount0, uint256 minAmount1)</code> redeems the caller’s shares. The recipient must be nonzero. You receive underlying assets in their current portfolio proportions, which may differ from what you originally supplied. There is no contract lockup or engine pause check.</p>
    <figure className={styles.figure} aria-label="Withdrawal flow and delivery outcomes">
      <FlowDiagram steps={[
        { label: 'Size the claim', sub: 'Collect fees; take a pro-rata share of idle tokens, adapters and LP liquidity.' },
        { label: 'Attempt delivery', sub: 'Isolate LP removal, adapter recalls and each recipient transfer.' },
        { label: 'Check & burn', sub: 'Enforce both minimum outputs; burn only the applicable shares.' },
      ]} />
      <div className={styles.branches}>
        <div className={styles.node}><strong>All portions delivered</strong><p>Burn the requested shares. A fresh mark is not required for complete pro-rata delivery.</p></div>
        <div className={styles.node}><strong>Some portion unavailable</strong><p>A usable exit mark and pool-deviation checks are required. Pay the permitted amount and retain shares, or revert if it cannot be done safely.</p></div>
      </div>
    </figure>
    <p>When an adapter or LP removal cannot deliver its requested portion, the engine calculates the <strong>least deliverable fraction</strong> across both token entitlements and reduces both payouts to that fraction. It burns the corresponding fraction of requested shares, rounded up, while requiring some requested shares to remain. This stops a recall failure from letting one holder take only the liquid side of everyone’s portfolio.</p>
    <p>If a recipient transfer is blocked, the engine can still deliver the other leg. It then measures the portfolio’s NAV reduction at the same mark and spot, and rounds the corresponding share burn up. Undelivered assets remain in NAV and the holder retains shares; the retained claim is on the remaining portfolio, not a fixed token IOU.</p>
    <p>Your minimum outputs are checked against actual delivery. Either minimum failing, both outputs being zero, or an incomplete exit consuming all requested shares causes a full revert. Token-unit and liquidity rounding can leave small residual balances.</p>
    <Note title="Callable does not mean guaranteed delivery">
      An unreadable <code>adapter.totalAssets()</code> fails closed with <code>AdapterNavUnavailable</code>, even for exits. The initial fee collection can also revert. Issuer restrictions, failed settlement, missing exit marks and output minimums can prevent completion. For RWA appraisal grace and full exits after grace, see <Link href="/docs/rwa#stale-appraisal">RWAs</Link>.
    </Note>
    <p>See <Link href="/docs/security#roles">the role and pause matrix</Link> for exactly who may call each operation.</p>
    <Sources files={['contracts-v4/src/vaults/MintwareMarketEngineCore.sol', 'contracts-v4/src/vaults/MintwareMarketLifecycleModule.sol', 'contracts-v4/src/vaults/MintwareOwnedPoolMarketEngine.sol', 'contracts-v4/src/lib/MWGuardianPausable.sol', 'contracts-v4/src/lib/MWMarketShareMath.sol']} />
  </>
}
