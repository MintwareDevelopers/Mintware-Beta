import Link from 'next/link'
import { DocHeader, DocTable, H2, Note, Sources } from './DocPrimitives'

export function RisksDocs() {
  return <>
    <DocHeader title="Risks of a market position" lead="Shares represent a changing portfolio of two assets. Neither the token mix nor its value is fixed."
      status="Current markets use test tokens on testnets. Mintware’s engine, hook and composition have not had an external audit." />
    <H2 id="market-risk">Price movement and liquidity</H2>
    <p>Trading changes the token mix in the liquidity band. You can end up with more of the falling asset and less of the rising one. This divergence from simply holding the tokens is often called impermanent loss; fees may not offset it. Outside its range, a position can become one-sided and stop earning swap fees until price returns or the position is moved.</p>
    <p>A recenter is bounded by cooldown, tick movement and mark checks. It may fail to become executable after a large price move. Publicly observable transactions can also face adverse execution and competition for block inclusion; output and price limits bound specific calls, not all future portfolio outcomes.</p>
    <H2 id="exit-risk">Exit availability</H2>
    <p>There is no engine withdrawal lockup and pause does not gate withdrawal. That is different from guaranteed immediate delivery. Tokens can reject transfers, adapters can lack liquidity, and fee collection or pool settlement can fail. An unreadable adapter NAV blocks the withdrawal entirely.</p>
    <p>Incomplete delivery requires a usable mark and appropriate pool deviation. Some shares may remain after a successful partial exit. If the safe payout is zero, a minimum fails, or the partial burn would consume the entire requested claim, the transaction reverts. See <Link href="/docs/markets#withdraw">withdrawal behavior</Link>.</p>
    <H2 id="issuer-risk">Issuer and appraisal dependence</H2>
    <p>Permissioned assets depend on native token transfer rules as well as pool allowlists. Revoked eligibility, freezes or paused transfers can prevent delivery. An appraisal and its report hash record an issuer’s observation; the hook does not establish legal ownership, redemption rights, appraisal quality or the availability of a buyer.</p>
    <p>A stale RWA appraisal halts trading and leaves a longer window for valuing incomplete exits. Full in-kind delivery can remain possible after that window. These rules cannot override an issuer token’s transfer refusal.</p>
    <H2 id="mark-and-adapter-risk">Marks and adapters</H2>
    <p>A wrong but fresh mark can misprice shares. Fixed test marks do not follow market prices. A ratio-feed implementation still depends on correct feed selection, observation timing and any configured sequencer checks. The pool-deviation guard limits accepted disagreement; it does not prove either price is correct.</p>
    <p>Current market idle adapters earn nothing. An external yield adapter would add source solvency, fee, availability and valuation risks. NAV counts an adapter’s reported claim, which can exceed the amount it can deliver now.</p>
    <H2 id="operational-risk">Code and operational authority</H2>
    <p>Owners choose initial configuration and control risk-taking operations. Guardians can pause; adapter owners can change capacity or liquidity limits. Hook and adapter governance can change permissions. Loss of keys, misuse of authority, a shared software bug or failure of a common token can affect several markets despite their separate accounting.</p>
    <Note title="A position is not a bank deposit">
      Returns are variable and can be negative. There is no guaranteed principal, fixed APY or promised yield. Read the <Link href="/risk-disclosures">full risk disclosures</Link> and the <Link href="/docs/security">security and authority reference</Link>.
    </Note>
    <Sources files={['contracts-v4/src/vaults/MintwareMarketEngineCore.sol', 'contracts-v4/src/vaults/MintwareOwnedPoolMarketEngine.sol', 'contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol', 'contracts-v4/src/vaults/MintwareERC4626YieldAdapter.sol', 'contracts-v4/src/vaults/ChainlinkUsdRatioMarketMark.sol', 'contracts-v4/src/lib/MWGuardianPausable.sol']} />
  </>
}

export function SecurityDocs() {
  return <>
    <DocHeader title="Security and authority" lead="Your wallet signs the transaction; contracts hold and operate the portfolio. The important questions are which code runs and who can change its behavior."
      status="Testnet software with mock/test assets. Uniswap’s own Permissioned Pools contracts are audited; Mintware’s engines, custom hook and composition are unaudited." />
    <H2 id="roles">Who can call what?</H2>
    <DocTable caption="Engine authority in the current source" headers={['Caller', 'Operations', 'Pause behavior']} rows={[
      ['Owner / operator', 'configureAdapters and activate; allocateIdle and deployLiquidity. “Operator” describes the owner’s operational role; there is no separate engine operator or keeper role.', 'Allocation and deployment are blocked while paused. Configuration and activation have no pause modifier.'],
      ['Owner', 'Set guardian and maxPauseDuration; unpause immediately. Inherited ownership functions can change the owner.', 'The owner can set the timeout to zero, disabling timeout recovery. These controls have no engine timelock.'],
      ['Owner or guardian', 'pause()', 'Blocks deposit, allocateIdle, deployLiquidity and recenter. Does not pause a hookless pool’s trading.'],
      ['Anyone', 'harvest and recallIdle; recenter when due; unpauseAfterTimeout when enabled and elapsed.', 'Harvest and recall remain callable. Recenter requires unpaused state. Timeout recovery defaults to 30 days and is owner-adjustable.'],
      ['Share holder', 'withdraw own shares to a chosen nonzero recipient. Anyone may deposit when its checks pass; owned pools add eligibility checks.', 'Withdraw has no pause modifier. Deposit is blocked. Token, adapter and valuation conditions still apply.'],
      ['PoolManager / engine itself', 'unlockCallback is PoolManager-only with matching active data. removeLiquidityForExit, recallForExit, payExact and readPricesForExit are self-call-only helpers.', 'These are execution boundaries, not public withdrawal or bypass entry points.'],
    ]} />
    <p>The RWA hook has separate owner, keeper and guardian controls: only the keeper posts subsequent appraisals; owner/guardian can pause trading; owner resumes it. Keeper changes and post-initialization hook configuration changes wait 48 hours. Adapter checker, wrapper and swap-switch controls belong to the adapter owner and are not subject to that hook delay.</p>
    <H2 id="enforced-controls">What the code enforces</H2>
    <ul>
      <li>Immutable pool identity, mark source, lifecycle module and core risk settings; one-time dedicated adapter configuration.</li>
      <li>Constructor validation of the module’s exact runtime code hash, followed by authenticated PoolManager callbacks and an active-unlock data hash.</li>
      <li>Fresh mark and pool-deviation checks for new risk; measured token transfers; user minimum shares and exit amounts.</li>
      <li>Principal and position caps at the specified <Link href="/docs/valuation#caps">deposit/deployment checks</Link>, and bounded atomic recentering.</li>
      <li>Reentrancy protection on capital/lifecycle entry points and isolated exit subcalls for partial-delivery handling.</li>
      <li>Owned-pool share transfer refusal, mint-time eligibility and separate pool activity permissions.</li>
    </ul>
    <p>These are specific controls, not proof against every loss. A module pin preserves identity, not correctness. A separate engine ledger avoids pooled accounting across markets, but shared dependencies can still fail together.</p>
    <H2 id="audit-scope">Audit scope and evidence</H2>
    <p>The upstream Permissioned Pools audit scope does not include Mintware’s custom appraisal hook, pooled-share accounting, adapter choices or deployment configuration. An external audit is required before Mintware markets carry real value. Local tests and internal reviews are useful evidence, not an external audit.</p>
    <p>Inspect the <Link href="/docs/architecture">architecture and module boundary</Link>, <Link href="/docs/contracts">current deployment record</Link>, and <Link href="/docs/risks">risks</Link>. Verify installed code and configuration for the actual chain and address; source code alone does not prove a deployment’s runtime state.</p>
    <Sources files={['contracts-v4/src/lib/MWGuardianPausable.sol', 'contracts-v4/src/vaults/MintwareMarketEngineCore.sol', 'contracts-v4/src/vaults/MintwareMarketEngine.sol', 'contracts-v4/src/vaults/MintwareOwnedPoolMarketEngine.sol', 'contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol', 'lib/rwa/units.ts', 'config/deployments.json']} />
  </>
}
