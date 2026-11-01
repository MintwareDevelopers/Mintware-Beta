import Link from 'next/link'
import { RWA_STACK, RWA_STACK_CONTRACTS, RWA_STACK_DISCLOSURE } from '@/lib/rwa/units'
import { FlowDiagram } from '@/components/ui2/FlowDiagram'
import { DocHeader, DocTable, H2, Note, Sources } from './DocPrimitives'
import styles from '@/app/docs/docs.module.css'

export function RwaDocs() {
  return <>
    <DocHeader title="RWAs on the engine" lead="For a pool we create, the engine manages pooled capital and our hook enforces permissions and an appraisal-based trading band."
      status={RWA_STACK_DISCLOSURE} />
    <div className={styles.stack}>
      {RWA_STACK.map((part) => <div className={styles.node} key={part.label}>
        <strong>{part.label}</strong><small>{part.status}</small>
        {part.lines.map((line) => <p key={line}>{line}</p>)}
      </div>)}
    </div>
    <p>The current property unit uses <code>MintwareOwnedPoolMarketEngine</code> on Base Sepolia. The deployment record includes activation, seed contribution and liquidity deployment. It replaces the retired standalone property demo.</p>
    <H2 id="custody">Underlying tokens outside; virtual tokens inside</H2>
    <p>The pool’s currencies are the verified <code>PermissionsAdapter</code> and USDC. This Uniswap wrapper holds the restricted underlying property token and creates a 1:1 virtual currency that only PoolManager holds. When PoolManager takes an output, the wrapper burns the virtual units and delivers the underlying token to the recipient. See Uniswap’s <a href="https://developers.uniswap.org/docs/protocols/uniswap-labs-hooks/permissioned-pools/overview" target="_blank" rel="noreferrer">Permissioned Pools overview</a> for the underlying standard.</p>
    <figure className={styles.figure} aria-label="Owned pool custody flow">
      <FlowDiagram steps={[
        { label: 'Holder → engine', sub: 'Deposit underlying property tokens and/or USDC. Engine and idle adapters hold underlying.' },
        { label: 'Engine → adapter', sub: 'Transfer exact underlying funding; an approved wrapper mints virtual units to PoolManager.' },
        { label: 'PoolManager → engine', sub: 'On removal, take burns virtual units and returns underlying for an in-kind exit.' },
      ]} />
    </figure>
    <Note title="Two different meanings of adapter">
      The <strong>PermissionsAdapter</strong> is the pool’s virtual-token wrapper. The two <strong>idle adapters</strong> hold portfolio assets outside the pool. They serve different purposes and have different permissions. Depositors approve and transfer the engine’s underlying <code>token0()</code>/<code>token1()</code>, not the pool’s virtual token.
    </Note>
    <p>Pool currencies are sorted by their addresses. The engine replaces the adapter currency with its underlying token in that same slot, <strong>without sorting again</strong>. Appraisals, NAV, deposits and payouts preserve this correspondence. Always read the engine’s token order.</p>
    <H2 id="permissions">Three permission checks, not one allowlist</H2>
    <DocTable caption="Permission boundaries" headers={['Boundary', 'What must be allowed']} rows={[
      ['Pool activity flags', 'The issuer checker supplies SWAP_ALLOWED and LIQUIDITY_ALLOWED independently. A trader needs the swap flag; engine and share recipient need the liquidity flag for new shares.'],
      ['Trusted wrappers', 'The adapter owner approves wrappers with allowedWrappers. The hook checks trust before calling msgSender() to obtain the represented principal. The owned engine reports itself, not the person calling recenter.'],
      ['Native token custody', 'The issuer token’s own transfer restrictions still apply to contributors, recipients, the PermissionsAdapter, the engine and the property idle adapter. Pool flags do not override native transfer rules.'],
    ]} />
    <p>Only the bound engine may add or remove liquidity through this hook. Adds check wrapper trust and the engine’s liquidity flag. Removals and fee collection do not check current allowlist permission, wrapper approval, trading pause, swap enablement or appraisal freshness. Underlying transfers must still succeed.</p>
    <p>Owned-pool shares cannot transfer between nonzero addresses: both <code>transfer</code> and <code>transferFrom</code> hit <code>SharesNonTransferable</code>. This prevents passing an existing pooled claim around the eligibility checks enforced on mint. It does not add forced seizure or recovery. Burns remain possible for exits.</p>
    <H2 id="appraisal">The appraisal is also the engine’s mark</H2>
    <p><code>MintwareRwaAppraisalHook</code> implements <code>IMarketAssetMark</code>. A publication includes an appraisal tick, the time the underlying observation was made, and a report hash. Zero or future observation times, non-increasing observation times and an empty report hash are rejected. The report hash is emitted in <code>ObservationRecorded</code>; the contract does not verify the appraisal’s real-world truth.</p>
    <p>The first appraisal may be initialized by the owner or keeper. Later <code>postAppraisal(int24 tick, uint64 observation, bytes32 reportHash)</code> calls are keeper-only. Three constraints limit updates:</p>
    <ul>
      <li><code>maxStepTicks</code> bounds each absolute tick change.</li>
      <li><code>minUpdateInterval</code> spaces publications using their on-chain publication time.</li>
      <li><code>maxDriftTicksPerDay</code> caps the sum of absolute movements in the rolling 24 hours. Reversals count too; each movement expires separately.</li>
    </ul>
    <p>Freshness uses the observation time, not publication time. Read <code>config()</code> for the actual band, fee, cadence, drift, age and grace parameters. The configuration fields are policy limits for this hook; they are not a promised valuation range for the asset.</p>
    <H2 id="band">Trading band and the gap-closing exception</H2>
    <p>Before a swap, the hook requires a bound engine, enabled adapter swap switch, approved wrapper and permitted trader, an unpaused hook, and a fresh appraisal. It selects <code>coreFeePips</code> or <code>specFeePips</code> from the <strong>pre-swap</strong> distance to the appraisal tick.</p>
    <figure className={styles.figure} aria-label="Swap rule decision flow">
      <FlowDiagram steps={[
        { label: 'Permission & freshness', sub: 'All entry checks pass; select fee from the starting band.' },
        { label: 'Execute swap', sub: 'PoolManager computes the resulting price.' },
        { label: 'Check ending tick', sub: 'Inside outer band: accept. Outside: apply the gap-closing test.' },
      ]} />
      <div className={styles.branches}>
        <div className={styles.node}><strong>Outside, same side, closer</strong><p>Accept if the ending tick is strictly nearer the appraisal and stays on the same side as the starting tick.</p></div>
        <div className={styles.node}><strong>Other outside-band result</strong><p>Revert the swap, including a move that crosses the appraisal and ends beyond the opposite outer boundary.</p></div>
      </div>
    </figure>
    <p>This exception lets trades reduce a gap after an appraisal moves. It does not permit arbitrary trading outside the outer band. The hook’s appraisal band is distinct from the engine’s LP range; the engine independently applies its pool-versus-mark guard when deploying or recentering.</p>
    <H2 id="governance">Keeper rotation and configuration</H2>
    <p>Replacing the keeper requires owner proposal and confirmation after <strong>48 hours</strong>. Configuration can change immediately before pool initialization; after the pool is bound, changes use a 48-hour proposal/confirmation delay. Appraisal maximum age and exit grace are frozen once the pool key is pinned. The owner can replace the guardian immediately.</p>
    <p>The hook owner or guardian can call <code>pauseTrading()</code>; only the owner calls <code>resumeTrading()</code>. This is independent of the engine’s pause. The adapter owner separately controls the checker, trusted wrappers and swap switch. Those adapter controls do not inherit the hook’s timelock.</p>
    <H2 id="stale-appraisal">Stale appraisal: trading halts, exits get a grace window</H2>
    <DocTable caption="Freshness affects trading and valuation differently" headers={['Appraisal state', 'Trading and new capital', 'Exits']} rows={[
      ['Fresh', 'Subject to permissions, pause, switch and engine checks.', 'Full delivery or partial delivery with a usable exit mark and the applicable guards.'],
      ['Stale, within exit grace', 'Hook swaps halt. Engine fresh-price reads fail, blocking deposits, deployment and recenter.', 'The exit mark can still value an incomplete delivery. Full in-kind delivery does not need a mark.'],
      ['Beyond exit grace', 'Trading remains halted until a valid fresh appraisal is published.', 'Complete pro-rata in-kind delivery can still succeed. Incomplete delivery requiring a mark reverts.'],
    ]} />
    <p>Permission revocation does not by itself gate pool removal or collection. However, issuer freezes, blocked recipients, unreadable adapter NAV or failed fee collection can still prevent a withdrawal. A recenter that cannot re-add liquidity reverts atomically, restoring the original position.</p>
    <H2 id="routing-status">What is not enabled yet</H2>
    <p>The committed deployment record says swaps are disabled: the adapter swap switch is off and no router is allowed. Trading needs a permissioned router approved in <code>allowedWrappers</code>, its trader principal allowed to swap, the switch enabled, and all hook and native transfer checks satisfied. The owned engine’s optional idle-swap path is deliberately disabled.</p>
    <p>The asset and allowlist are test-only fixtures with open setters, not production issuer controls. The app’s <Link href="/app/rwas">RWA unit</Link> and <Link href="/docs/integrating#public-reads">public read endpoint</Link> expose current reads separately from these recorded deployment facts.</p>
    <DocTable caption="Shared RWA stack reference" headers={['Contract', 'Explorer']} rows={RWA_STACK_CONTRACTS.map((contract) => [
      contract.name,
      <a key={contract.name} href={`${contract.explorer}/address/${contract.address}`} target="_blank" rel="noreferrer"><code>{contract.address}</code></a>,
    ])} />
    <p>See <Link href="/docs/contracts">all current deployments</Link>, including the issuer fixtures and idle adapters.</p>
    <Sources files={['contracts-v4/src/vaults/MintwareOwnedPoolMarketEngine.sol', 'contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol', 'contracts-v4/src/lib/MWV4Settlement.sol', 'contracts-v4/lib/v4-periphery-permissioned/src/hooks/permissionedPools/PermissionsAdapter.sol', 'contracts-v4/lib/v4-periphery-permissioned/src/hooks/permissionedPools/libraries/PermissionFlags.sol', 'lib/rwa/units.ts', 'config/deployments.json']} />
  </>
}
