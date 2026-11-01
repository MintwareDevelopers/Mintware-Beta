import Link from 'next/link'
import { Code, DocHeader, DocTable, H2, Note, Sources } from './DocPrimitives'
import { depositSnippet, setupSnippet, withdrawSnippet } from './snippets'

export function IntegrationDocs() {
  return <>
    <DocHeader title="Integrating a market" lead="Discover the engine, read its underlying assets, simulate your call, and reconcile the receipt against actual shares and payouts."
      status="Examples target the recorded Base Sepolia test deployment. Test tokens only; Mintware contracts are unaudited." />
    <H2 id="reads">Read the engine at one block</H2>
    <p>Use a single <code>blockNumber</code> for related portfolio reads, so balances, supply, liquidity and marks describe the same state. <code>lib/gateway/marketEngine.ts</code> provides <code>readMarketEngineSnapshot</code>, used by the RWA reader. Treat unavailable NAV as unknown, never as zero.</p>
    <DocTable caption="Useful contract views" headers={['Read', 'Interpretation']} rows={[
      [<code key="f">token0(), token1(), quoteAsset(), poolKey(), poolManager()</code>, 'Underlying input/output order, quote denomination, and the pool identity. For owned RWAs, PoolKey uses the virtual adapter while token0/token1 use underlying.'],
      [<code key="f">activated(), paused(), owner(), guardian()</code>, 'Engine admission and control state. An active registry row does not replace these checks.'],
      [<code key="f">totalNav(), totalSupply(), balanceOf(account), decimals()</code>, 'Marked portfolio value in raw quote units, 18-decimal share supply and account ownership. totalNav excludes pending LP fees and may revert.'],
      [<code key="f">adapter0(), adapter1(), positionLiquidity(), tickLower(), tickUpper()</code>, 'Where assets rest and the current LP range. Read balances on the underlying token contracts and totalAssets on adapters.'],
      [<code key="f">nonQuoteMark(), lifecycleModule()</code>, 'Installed price source and immutable callback executor. Read latestMark on the mark contract.'],
      [<code key="f">recenterEdgeTicks(), maxRecenterTickMove(), recenterCooldown(), lastRecenterAt()</code>, 'Public recenter settings. Also read PoolManager spot to assess whether a move is due.'],
      [<code key="f">pausedAt(), maxPauseDuration()</code>, 'Engine pause timestamp and timeout; zero duration disables permissionless timeout recovery.'],
      [<code key="f">appraisalHook(), permissionsAdapter()</code>, 'Owned-wrapper-only getters. On the hook: bandStatus(), config(), isFresh(), oracleReady(), tradingPaused(), observedAt(). On the adapter: allowedWrappers(), isAllowed(), swappingEnabled().'],
    ]} />
    <p>The shared <code>MARKET_ENGINE_ABI</code> covers app reads and deposit/withdraw. Add source-confirmed view signatures with viem’s <code>parseAbi</code> when you need getters not included there. Internal immutable caps and mark-age limits have no public getters; inspect the deployment’s constructor configuration.</p>
    <H2 id="deposit-code">Deposit from code</H2>
    <Code label="Actual engine entry points">{`function deposit(uint256 amount0, uint256 amount1, uint256 minSharesOut)
  external returns (uint256 sharesMinted)

function withdraw(uint256 shares, address recipient, uint256 minAmount0, uint256 minAmount1)
  external returns (uint256 burned, uint256 amount0Out, uint256 amount1Out)`}</Code>
    <p>The following snippets run in order within your app, using connected viem clients and the repository’s existing ABI. Use the <code>RwaOwnedPool_Engine</code> deployment key instead for the owned unit, after checking contributor and engine permissions. Its deposit assets are still the underlying engine tokens.</p>
    <Code label="1. Select the deployment and token order">{setupSnippet}</Code>
    <p>Read each underlying token’s <code>decimals()</code> before converting a user-entered amount to raw units. Approvals go to the engine. You may contribute zero of one token; both amounts cannot be zero. There is no <code>previewDeposit</code> method on this two-asset engine: use its math and a fresh simulation, allowing for fees collected during the actual deposit.</p>
    <Code label="2. Approve, simulate and deposit">{depositSnippet}</Code>
    <H2 id="withdraw-code">Withdraw from code</H2>
    <p>A withdrawal burns the caller’s shares; it is not an ERC-4626 redeem on behalf of another owner. Set both minimum token amounts from your accepted payout bounds. Zero is permitted for a withdrawal minimum, but gives up protection for that token. Simulation previews a point in time, not a guarantee at transaction inclusion.</p>
    <Code label="3. Simulate and withdraw in kind">{withdrawSnippet}</Code>
    <Note title="Handle an incomplete exit explicitly">
      A successful receipt can burn fewer shares than requested. Display the actual amounts, then re-read the holder’s balance. A failed minimum or unavailable partial-exit mark reverts the entire transaction; it does not create a withdrawal queue. Explain the failure and let the user choose whether to retry with new bounds.
    </Note>
    <H2 id="events">Events to reconcile</H2>
    <Code label="Share-changing event signatures">{`event Deposited(address indexed account, uint256 amount0, uint256 amount1, uint256 shares)
event Withdrawn(address indexed account, address indexed recipient, uint256 sharesBurned, uint256 amount0, uint256 amount1)`}</Code>
    <DocTable caption="Operational events" headers={['Events', 'What they tell you']} rows={[
      [<code key="e">EngineActivated</code>, 'The bound adapters and mark at activation.'],
      [<code key="e">IdleAllocated, IdleRecalled, LiquidityDeployed, IdleSwapped</code>, 'Allocation requests, measured recalls, added liquidity and actual swap inputs/outputs.'],
      [<code key="e">FeesCollected, PositionRecentered</code>, 'Explicit harvest receipts; old/new ticks and resulting liquidity for recenter. Internal fee collections do not separately emit FeesCollected.'],
      [<code key="e">Transfer, Paused, Unpaused, GuardianSet, MaxPauseDurationSet, AutoUnpaused</code>, 'Share movement/mint/burn and engine control changes. Owned shares permit mint/burn only.'],
      [<code key="e">ObservationRecorded, AppraisalPosted, KeeperProposed, KeeperSet, ConfigProposed, ConfigApplied, TradingPaused, TradingResumed</code>, 'Appraisal provenance and hook governance. The observation timestamp and report hash are in ObservationRecorded; publication time is in AppraisalPosted.'],
    ]} />
    <p>Index by chain, engine address, transaction and log position, with reorganization handling. Decode events from the expected contract address. A recorded operation is not a substitute for current balances or token eligibility.</p>
    <H2 id="public-reads">Public app read routes</H2>
    <p>These GET routes exist in the app. The <code>gateway</code> path is a compatibility name for market discovery and the engine registry, not the retired LP Gateway product. Addresses and pool identifiers in query examples below are placeholders.</p>
    <DocTable caption="Read endpoints and response boundaries" headers={['GET route', 'Parameters', 'Response and limitations']} rows={[
      [<code key="r">/api/rwa/unit</code>, <code key="q">unit=wcp7&amp;account=&lt;wallet&gt;</code>, 'unit defaults to wcp7; account is optional. One-block engine and hook reads, underlying balances, mark/band and permissions. source is live, cached or undeployed. Missing deployment configuration returns undeployed; failed reads return a previous cached result or 503. Short-lived successful responses are also cached.'],
      [<code key="r">/api/gateway/markets</code>, 'None', 'Active, verified registry markets across configured market chains. Includes engine address, chainId, pair label and navQuote; NAV can be null. Cached for 30 seconds. A failed chain registry read can omit that chain’s rows.'],
      [<code key="r">/api/gateway/instances</code>, <code key="q">chainId=&lt;id&gt;&amp;all=1</code>, 'Registry records. Defaults to the configured chain and active rows; all=1 includes inactive rows. Returns an empty list if engine configuration is absent. positionManager is a compatibility alias for engineAddress.'],
      [<code key="r">/api/gateway/meta</code>, <code key="q">pool=&lt;pool-id&gt;</code>, 'Resolves a verified engine and returns token order, decimals, quote, chain and ticks. Optional pm selects an engine generation, including inactive engines for exits. Use the RWA endpoint for owned-pool hook state, not the legacy dynamicFee field here.'],
      [<code key="r">/api/gateway/position</code>, <code key="q">address=&lt;wallet&gt;&amp;pool=&lt;pool-id&gt;</code>, 'Current shares, supply and marked claim; nullable NAV/valuation. Cost basis replays verified transaction events and is unavailable for non-quote contributions or share mismatches. Optional pm selects a generation; inactive engines remain resolvable for exits.'],
      [<code key="r">/api/gateway/discover</code>, 'None', 'Pool watchlist, activity and ranking signals. A discovery result is not an approved deployment; the feed can be cached or empty when its source/configuration is unavailable.'],
    ]} />
    <p>These are public reads, subject to rate limits and runtime configuration. The RWA endpoint reports its block and source; do not treat a cached snapshot as current eligibility. <code>POST /api/rwa/live-trade</code> and the old buffer write on <code>POST /api/gateway/position</code> are retired with HTTP 410. Signing and broadcasting the examples above happens in your connected wallet.</p>
    <p>For each engine address and explorer, see <Link href="/docs/contracts">Contracts</Link>.</p>
    <Sources files={['lib/web3/artifacts/marketEngine.ts', 'lib/gateway/marketEngine.ts', 'lib/rwa/read.ts', 'contracts-v4/src/vaults/MintwareMarketEngineCore.sol', 'app/api/rwa/unit/route.ts', 'app/api/gateway/markets/route.ts', 'app/api/gateway/instances/route.ts', 'app/api/gateway/meta/route.ts', 'app/api/gateway/position/route.ts', 'app/api/gateway/discover/route.ts', 'app/api/rwa/live-trade/route.ts']} />
  </>
}
