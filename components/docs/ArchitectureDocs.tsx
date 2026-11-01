import Link from 'next/link'
import { FlowDiagram } from '@/components/ui2/FlowDiagram'
import { DocHeader, DocTable, H2, Note, Sources } from './DocPrimitives'
import styles from '@/app/docs/docs.module.css'

export function ArchitectureDocs() {
  return <>
    <DocHeader title="Contract architecture" lead="The engine owns assets and shares. A stateless lifecycle module executes pool operations in the engine’s context."
      status="Mintware’s engine, hook and integration are unaudited testnet software. An upstream audit does not cover this composition." />
    <H2 id="contract-map">The contract map</H2>
    <figure className={styles.figure} aria-label="Contract inheritance and external call map">
      <div className={styles.branches}>
        <div className={styles.node}><strong>MintwareMarketEngine</strong><p>Hookless-pool wrapper. Rejects a nonzero pool hook.</p></div>
        <div className={styles.node}><strong>MintwareOwnedPoolMarketEngine</strong><p>Owned-pool wrapper. Validates the appraisal hook, adapter, factory mapping and pool identity.</p></div>
      </div>
      <div className={styles.edge}>Both inherit ↓</div>
      <div className={styles.state}><strong>MintwareMarketEngineCore</strong><p>Shares, deposits, withdrawals, NAV, adapter calls and lifecycle guards. Inherits pool identity, owner/guardian pause and reentrancy protection from MintwareV4PoolVault; ERC-20 provides the share ledger.</p></div>
      <div className={styles.branches}>
        <div className={styles.node}><strong>Reads → IMarketAssetMark</strong><p>Fixed test mark, ratio-feed mark or appraisal hook. MWMarketValuation checks freshness and converts values.</p></div>
        <div className={styles.node}><strong>Calls → IMarketAdapterBinding × 2</strong><p>Reads claims and capacity; deposits or recalls each underlying token. MWMarketShareMath converts value to shares.</p></div>
      </div>
      <div className={styles.edge}>Core calls PoolManager.unlock(data); PoolManager calls engine.unlockCallback(data) ↓</div>
      <div className={styles.node}><strong>Delegatecall → MintwareMarketLifecycleModule</strong><p>Collect, add, remove, optional swap, or recenter. MWV4PositionEngine calls PoolManager.modifyLiquidity; swaps call PoolManager.swap. MWV4Settlement pays debts and takes receipts.</p></div>
      <div className={styles.edge}>Calls execute as the engine ↓</div>
      <div className={styles.state}><strong>Uniswap PoolManager</strong><p>Stores pool state and the engine-owned LP position. Settles currency deltas. In an owned pool, calls MintwareRwaAppraisalHook for initialization, liquidity and swap checks.</p></div>
      <figcaption>Arrows describe calls, not separate custody accounts. Library functions are internal code, not additional operators or deployed treasuries.</figcaption>
    </figure>
    <H2 id="lifecycle-module">Why a separate, pinned lifecycle module?</H2>
    <p>The module separates callback execution from the engine’s claim accounting. It has no asset or share ledger of its own. A <code>delegatecall</code> means its pool and token calls execute as the engine address; it returns liquidity and range results for the engine to persist.</p>
    <p>That execution power makes module identity critical. Both concrete engine wrappers pass an expected runtime code hash to the core constructor. Construction rejects any module whose deployed runtime does not match that hash. The module address is immutable, with no module-upgrade setter. The pin covers exact compiled runtime bytes, including metadata where present; it is not merely a contract-name check.</p>
    <figure className={styles.figure} aria-label="Authenticated PoolManager callback sequence">
      <FlowDiagram steps={[
        { label: 'Open an unlock', sub: 'Engine records the hash of typed action data and calls PoolManager.' },
        { label: 'Authenticate callback', sub: 'Only PoolManager; data must match the active hash. Nested unlocks fail.' },
        { label: 'Execute & persist', sub: 'Delegatecall pinned module; settle deltas, store returned state, clear hash.' },
      ]} />
    </figure>
    <Note title="A pin is an integrity check, not an audit">
      The pin rejects substituted module code. It does not prove that the approved module is correct. The current deployment record lists a newer module for the owned RWA engine; existing hookless deployments retain their previously installed modules. Read each engine’s <code>lifecycleModule()</code> rather than assuming all use one address.
    </Note>
    <H2 id="shared-libraries">Shared libraries and adapters</H2>
    <DocTable caption="Mintware implementation responsibilities" headers={['Piece', 'Responsibility']} rows={[
      [<code key="s">MWMarketShareMath</code>, 'Bootstrap normalization, proportional deposit shares and partial-exit share burns. The engine supplies NAV; the library does not choose marks.'],
      [<code key="s">MWMarketValuation</code>, 'Fresh, nonzero, non-future mark checks and decimal-aware conversion into raw quote units.'],
      [<code key="s">MWV4PositionEngine</code>, 'Direct PoolManager liquidity mutations and measured token consumption/receipts during an active unlock.'],
      [<code key="s">MWV4Settlement</code>, 'sync/pay/settle/take plumbing. For an owned pool, funds the PermissionsAdapter with underlying, verifies exact funding, then wraps virtual units to PoolManager.'],
      [<code key="s">MWV4PositionMath / MWV4TickSpacing</code>, 'Liquidity and token-quantity calculations, quote orientation and tick alignment.'],
      [<code key="s">IMarketAdapterBinding</code>, 'IYieldAdapter plus asset() and vault(). The engine verifies token identity and dedicated engine binding before activation.'],
      [<code key="s">MintwareIdleYieldAdapter</code>, 'Holds tokens without yield. Only the bound vault supplies/withdraws. Its separate owner-adjustable deposit cap counts supplied principal, not donations.'],
      [<code key="s">MintwareERC4626YieldAdapter</code>, 'A source implementation over an external ERC-4626 vault. Reports fee-net redeemable assets, supplies within source capacity, and recalls subject to source liquidity and a per-block cap. Not the idle-only setup in current market records.'],
    ]} />
    <H2 id="ownership-boundaries">Which parts come from whom?</H2>
    <p><strong>Mintware</strong> supplies the engines, lifecycle module, appraisal hook, adapters and MW libraries above, plus registry verification and the app. <strong>Uniswap</strong> supplies PoolManager and v4 pool mechanics, the PermissionsAdapter and its factory, and permissioned routing infrastructure. The <strong>issuer</strong> supplies the asset, native token transfer policy, allowlist checker and appraisal observations; those issuer roles use test fixtures in the current RWA demonstration.</p>
    <p>The owned engine keeps a direct pooled position, with its own non-transferable shares. It does not use the permissioned PositionManager’s NFT ownership or recovery mechanism. For permission and custody details, continue to <Link href="/docs/rwa">RWAs and owned pools</Link>.</p>
    <Sources files={['contracts-v4/src/vaults/MintwareMarketEngine.sol', 'contracts-v4/src/vaults/MintwareMarketEngineCore.sol', 'contracts-v4/src/vaults/MintwareOwnedPoolMarketEngine.sol', 'contracts-v4/src/vaults/MintwareMarketLifecycleModule.sol', 'contracts-v4/src/vaults/MintwareV4PoolVault.sol', 'contracts-v4/src/vaults/IMarketAdapterBinding.sol', 'contracts-v4/src/vaults/MintwareIdleYieldAdapter.sol', 'contracts-v4/src/vaults/MintwareERC4626YieldAdapter.sol', 'contracts-v4/src/lib/MWMarketShareMath.sol', 'contracts-v4/src/lib/MWMarketValuation.sol', 'contracts-v4/src/lib/MWV4PositionEngine.sol', 'contracts-v4/src/lib/MWV4Settlement.sol', 'config/deployments.json']} />
  </>
}
