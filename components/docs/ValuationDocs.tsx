import Link from 'next/link'
import { Code, DocHeader, DocTable, H2, Note, Sources } from './DocPrimitives'

export function ValuationDocs() {
  return <>
    <DocHeader title="NAV, shares and price marks" lead="The pool determines the token quantities in a position. A separate mark determines their value in the quote token."
      status="Current hookless deployments use fixed test marks. Test tokens and unaudited contracts; these marks are unsuitable for real-value pricing." />
    <H2 id="nav">What NAV includes</H2>
    <p><code>totalNav()</code> returns the portfolio’s net asset value in <strong>raw quote-token units</strong>. For a six-decimal quote token, a result of one million means one whole quote token, not one million dollars.</p>
    <Code label="Portfolio accounting (conceptual)">{`assets0 = engine balance0 + adapter0.totalAssets() + LP amount0
assets1 = engine balance1 + adapter1.totalAssets() + LP amount1
NAV = quoteValue(assets0, price0) + quoteValue(assets1, price1)

quoteValue(amount, priceWad) = floor(
  amount × priceWad / 10^(assetDecimals + 18 - quoteDecimals)
)`}</Code>
    <p>The quote token’s mark is one quote token, scaled by <code>1e18</code>. The other token’s mark is quote tokens per whole asset token at that same scale. Pool spot and range ticks determine the LP token quantities. NAV includes recognized donations, but excludes uncollected position fees until a collection action such as <code>harvest()</code>.</p>
    <p>This is a marked portfolio value, not an immediately executable sale quote or proof of available cash. Mark freshness or adapter read failures can make NAV unavailable while shares still exist.</p>
    <H2 id="share-math">Mint and burn math</H2>
    <Code label="Market shares have 18 decimals; NAV and contributions use raw quote units">{`// First issuance, when share supply is zero:
new contribution >= minInitialContribution
shares = NAV_after × 10^(18 - quoteDecimals)

// Later deposits:
contribution = NAV_after - NAV_before
shares = floor(contribution × supply_before / NAV_before)

// Marked value of an account (not a payout quote):
claim = floor(account_shares × NAV / total_supply)

// Incomplete recipient delivery:
burned = ceil(NAV_reduction × supply_before / NAV_before)
retained = requested_shares - burned`}</Code>
    <p>For deposits, both NAV snapshots use the same mark and post-callback spot. A zero contribution, zero minted shares, or zero starting NAV with an existing supply is rejected. There are no virtual share offsets in the market share math. First issuance recognizes existing donations in the initial share count; the minimum initial contribution must still come from the new deposit.</p>
    <p>A fully delivered pro-rata withdrawal burns all requested shares, without needing a mark. In a recall shortfall, both payouts are limited to the least deliverable fraction and shares burned are rounded up from that fraction. A recipient-leg failure instead uses measured NAV reduction. Partial exits must retain some requested shares. See the <Link href="/docs/markets#withdraw">withdrawal flow</Link> for failure cases.</p>
    <H2 id="marks">The mark interface and implementations</H2>
    <p><code>IMarketAssetMark</code> exposes <code>asset()</code>, <code>quoteAsset()</code> and <code>latestMark() → (uint256 priceWad, uint64 updatedAt)</code>. The engine checks the asset pair at construction. <code>MWMarketValuation.freshPriceWad</code> rejects zero prices, missing or future timestamps, and observations older than the permitted age.</p>
    <DocTable caption="Three mark sources in the repository" headers={['Source', 'How it works', 'Limit']} rows={[
      [<code key="s">FreshTestMark</code>, 'Immutable price and deployment timestamp; recorded as MintwareFixedTestMark in deployments.json.', 'A mechanics-only test fixture. Reading it does not refresh its timestamp, so it eventually becomes stale.'],
      [<code key="s">ChainlinkUsdRatioMarketMark</code>, 'Normalizes asset/USD and quote/USD feeds, then divides them. Returns the older observation timestamp. Optionally checks sequencer uptime and recovery grace.', 'Source implementation, with no current deployment entry. Feed suitability and identity are admission decisions; code checks alone cannot prove them. The consumer enforces age.'],
      [<code key="s">MintwareRwaAppraisalHook</code>, 'Converts the dated appraisal tick into a quote-per-underlying mark, accounting for decimals and currency orientation.', 'An issuer-supplied appraisal is not a redemption guarantee. Trading freshness and the longer exit-mark window are separate.'],
    ]} />
    <H2 id="deviation">Pool price versus mark</H2>
    <p>The guard compares the pool-implied quote value of one whole non-quote token against its marked value. Both must be nonzero and use the same raw quote units. Token ordering and decimal differences are handled before comparison.</p>
    <Code label="Spot-deviation guard">{`abs(poolQuoteRaw - markedQuoteRaw)
  <= floor(markedQuoteRaw × maxSpotMarkDeviationBps / 10_000)`}</Code>
    <p>Activation, deposits, deployment, optional idle swaps and recentering use this guard. Incomplete withdrawals use it too, because they need to value the remaining claim. Complete in-kind withdrawals do not. The guard rejects operations outside its tolerance; it does not force a pool back to the mark or prevent all adverse execution inside the tolerance.</p>
    <H2 id="caps">Principal and position caps</H2>
    <DocTable caption="Caps constrain admission and deployment, not every market movement" headers={['Setting', 'Enforced behavior']} rows={[
      [<code key="s">principalCap</code>, 'Despite the name, the engine compares total marked NAV against this raw quote-unit cap on deposits and before/after liquidity deployment. It is not a lifetime sum of contributed principal.'],
      [<code key="s">maxPositionBps</code>, 'Deployment limits marked LP value to floor(NAV × maxPositionBps / 10,000), scaling idle budgets to the available room and checking again after the add.'],
      ['Configuration', 'Both are immutable constructor inputs. Price moves, donations or fees can move value above a cap without triggering automatic liquidation. Recenter does not run the deployment cap checks.'],
    ]} />
    <Note title="Read configuration, do not assume defaults">
      <code>maxMarkAge</code>, <code>maxSpotMarkDeviationBps</code>, <code>minInitialContribution</code>, <code>principalCap</code> and <code>maxPositionBps</code> are internal immutables, without public getters in this source. Inspect the verified constructor configuration for the specific deployment. Recenter settings do have public getters. There is no universal per-market percentage or age limit to copy from this page.
    </Note>
    <Sources files={['contracts-v4/src/vaults/MintwareMarketEngineCore.sol', 'contracts-v4/src/lib/MWMarketShareMath.sol', 'contracts-v4/src/lib/MWMarketValuation.sol', 'contracts-v4/src/vaults/IMarketAssetMark.sol', 'contracts-v4/src/vaults/ChainlinkUsdRatioMarketMark.sol', 'contracts-v4/script/DeployMarketTestMark.s.sol', 'contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol', 'config/deployments.json']} />
  </>
}
