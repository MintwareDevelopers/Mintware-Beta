# RWA liquidity through the shared MarketEngine

Design decision · 2026-10-31 · Base Sepolia only · fictional property and valueless tokens.
This document proposes implementation; it does not change or deploy any contract.
Current-code citations refer to baseline `577e95468b1f1bb92d779732af06cfa4e9ebd5de`.

## Recommendation and inherited decisions

Use one ordinary `MintwareMarketEngine` instance per property asset/quote pair, running the same
`MintwareMarketEngineCore`, lifecycle module, adapters and registry as other markets. Add only an
issuer appraisal implementation of `IMarketAssetMark`. Choose a hookless pool, one transferable
portfolio share and in-kind exits. Issuer inventory receives the same shares as anyone else's capital;
there is no senior claim, junior cover, RWA vault, collateral position or credit product here.
“One engine per asset” means one curated active engine for its selected quote/pool, not an on-chain
ban on other pools; retired generations remain addressable for exits.

This follows the current one-share engine direction (`.claude/STATE.md:22-34,38-47`;
`.claude/rules/lp-gateway.md:9-18,27-34`). The concrete wrapper passes `allowHookedPool=false`
and pins the lifecycle codehash (`contracts-v4/src/vaults/MintwareMarketEngine.sol:10-18`).
Registry resolution already distinguishes active/inactive generations
(`lib/gateway/marketEngine.ts:62-94`). No RWA-specific engine subclass is proposed.

Prior work harvested, without treating branch proposals as implemented behavior:

| Source examined | Decision carried forward |
|---|---|
| `docs/target-architecture` at `bbdd22033`: `docs/developers/target-architecture.md:13-23` | Shared engine, lending seam, no tranche stack. This file is absent on the working branch. Its proposed permissioned-hook route is superseded for this pilot by token-level enforcement. |
| `wip/codex-snapshot-2026-10-28` at `1a4e18956`: `docs/product/platform-architecture-adjudication-2026-10-28.md:220-254` | Script deployment, independent mark, explicit activation, transfer/exit qualification; an RWA label creates no new vault type. |
| `feat/contracts-v2` at `3c977d0d5`: `docs/developers/v2/DECISIONS.md:10-13,37` | Direct PoolManager custody, bound adapters and removing redundant registry fields; do not import that branch's broader contract stack. |
| `.claude/rules/rwa-liquidity.md:15-25` | Preserve appraisal controls and the token gate, retire its Treasury/tranche assumptions. The current deploy script now uses a test liquidity actor, not Treasury (`contracts-v4/script/DeployRwaLiquidityUnit.s.sol:18-26,97-116`). |

## 1. Appraisal becomes the non-quote mark

**Decision:** introduce `IssuerAppraisalMark` under the existing mark implementation directory,
implementing the unchanged `asset()`, `quoteAsset()`, `latestMark()` interface. The interface returns
whole quote tokens per whole asset token, scaled by `1e18`, and the source observation timestamp
(`contracts-v4/src/vaults/IMarketAssetMark.sol:4-19`). Use dUSD as quote for this pilot; a USD
appraisal is not automatically a quote-token appraisal if a different quote loses its USD relationship.
No pool spot is used as the appraisal source.

The issuer's designated appraisal signer is the mark's `keeper`; it signs the publication transaction
directly. A separate owner controls delayed keeper rotation. No signature relay, verifier registry or
second oracle network is needed for this demo. A signed transaction proves who submitted a valuation,
not that the property valuation is correct. Keep the report hash, observation date and transaction
visible. Today the hook authenticates `msg.sender`, not an off-chain report signature, and stamps
publication time (`contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:222-264`).

Proposed publication API: `postAppraisal(int24 tick, uint64 observedAt, bytes32 reportHash)`.
Bind asset, quote, decimals and sorted token orientation immutably. Keep ticks solely as the
bounded logarithmic update coordinate so the audited movement algorithm can be reused; derive
`priceWad` deterministically with existing tick math and full-precision arithmetic, never RPC floats.
For property as currency0, `priceWad = 1.0001^tick × 10^(propertyDecimals-quoteDecimals) × 1e18`;
invert the raw tick ratio when property is currency1. Test both orderings and rounding boundaries.
Reject invalid ticks, zero/overflowed prices, zero/future/non-increasing observation timestamps and
empty report hashes. First publication is unbounded against a predecessor but must be reviewed before
activation. Return the report's `observedAt`, not publication time. An unchanged price needs a genuinely
new issuer assessment to refresh age; an operator heartbeat must not rejuvenate an old appraisal.

| Control | Recommended home and behavior | Current evidence |
|---|---|---|
| Step cap | Mark: `maxStepTicks=500` for rehearsal. Absolute move from last accepted tick. | Hook `postAppraisal`, `contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:237-243`. |
| Minimum interval | Mark: 10 minutes between accepted publications; track publication time separately from observation time. | Same hook `:242`; current demo defaults `contracts-v4/script/DeployRwaLiquidityUnit.s.sol:48-58`. |
| Rolling drift / MW-03 | Mark: retain `maxDriftTicksPerDay=1000`, sum absolute movements published in `(now−24h, now]`; reversals do not refund budget and each move expires separately. | Hook `:244-260`; regression `contracts-v4/test/audit-2026-10-31/RollingDrift.t.sol:23-82`. |
| Keeper rotation | Mark: owner proposes/confirms after 48h, including before activation; rotation never resets movement history. | Existing 48h constant and rotation: hook `:61,296-309`. |
| Mutable appraisal limits | Delete the hook's mutable config surface. Fix step, interval and drift limits at construction for the pilot. Changing policy requires a new mark/engine generation and explicit opt-in. | Hook currently permits instant pre-pool config, then 48h delay (`:314-331`); engine mark binding is immutable (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:190-203`). |
| Maximum age | Engine `maxMarkAge=30 days` for rehearsal, measured from source observation. Mark returns historical truth even when stale; no duplicate “fresh” authority. | `contracts-v4/src/lib/MWMarketValuation.sol:23-35`; core `:783-787`. |
| Spot disagreement | Engine `maxSpotMarkDeviationBps`; propose 300 bps for rehearsal. This compares quote prices, not raw tick distances. | Core `:848-861`. |
| Recenter controls | Existing edge threshold, cooldown and maximum tick move; no appraisal-triggered privileged recenter. | Core `:458-515`. |
| Exit grace | Delete `oracleGraceSecs` from the new mark. Complete in-kind delivery needs no fresh mark; incomplete delivery still requires one and spot agreement. | Core `:534-541,597-637`; old grace exists in hook `:267-281`. |

MW-03 is already fixed in this checkout: carry the cumulative checkpoints and binary-search window
boundary into the mark, with its regression cases. The fix tightens window semantics; it does not mean
the demo's numeric 1000-tick limit was reduced. Source and deployed bytecode must be checked separately;
the historic demo's deployed MW-03 status is **unverified** here.

These are rehearsal settings, not a validated property-risk model. Use a small quote-denominated
`principalCap`, an initial 20% maximum LP allocation, and an appraisal-centered initial range about
±1000 ticks, aligned to pool spacing; rehearsal must choose compatible edge/cooldown/move settings.
The cap is an action-time check, not continuous portfolio insurance (core `:399-440`).
If a genuine appraisal exceeds movement limits, pause new risk and review/reinstall explicitly;
do not fabricate intermediate assessments or bypass the cap. Existing exits retain the limitations below.

Engine age and spot checks protect activation, contributions, deployment and recentering
(core `:224-234,258-286,399-440,458-490`). They do not verify appraisal quality or constrain how far a
compromised signer can walk over many days. `allocateIdle`, `recallIdle` and `harvest` do not require a
fresh mark (core `:307-329,446-450`). Engine pausing and stopping publication are operational controls;
neither stops a hookless pool's swaps.

## 2. Drop the swap-level appraisal band

**Decision: option (a).** Keep `hooks=address(0)` and a static pool fee. Call the displayed appraisal
zone an **engine action tolerance**, never a trading floor or ceiling. The current hook rejects
out-of-band trades except same-side gap-closing trades and exempts its bound actor
(`contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:386-432`). That protection is intentionally removed.

| Choice | Code and audit cost | Interoperability and actual protection |
|---|---|---|
| **(a) Shared hookless pool — chosen** | Zero engine/lifecycle changes; remove the 348-nSLOC hook and extract only its valuation controls into the mark. Audit mark conversion, governance and integration. | Standard v4 execution, subject to token permission checks. Stops engine risk additions/recentering on disagreement; cannot stop third-party swaps or protect already-resting LP inventory from adverse selection. |
| (b) Exactly one audited hook | Retain/rewrite swap-hook behavior, change wrapper eligibility, fee validation, installer and curation; budget roughly 80–160 additional integration nSLOC before hook changes. Requires combined engine/hook audit. | Pool-specific hook behavior, router support checks and swap-path failure modes. Can stop trades beyond the band, but cannot make appraisal realizable or create buyers. The current hook's actor gate/exemption also needs reconciliation. |
| (c) App-only band or special router | Adds another execution policy and tests without an enforceable pool-wide limit. | Bypassable by direct pool access; reject. A custom curve, wrapper or vault would add a second system and is outside this design. |

Even passing `allowHookedPool=true` would not install today's dynamic-fee hook: core rejects fee
values over 1,000,000, while the old script sets `DYNAMIC_FEE_FLAG`. Its liquidity callbacks also admit
only one bound actor (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:132-144`;
`contracts-v4/script/DeployRwaLiquidityUnit.s.sol:87-94`;
`contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:368-381`). Option (b) is not a one-line exception.

A property LP needs a credible dated valuation, explicit inventory exposure, bounded deployed capital,
permitted delivery routes and honest information about exit liquidity. A stale appraisal band can prevent
price discovery while saying nothing about realizable property proceeds. The chosen design accepts
inventory losses and market discounts; appraisal is an accounting input, not issuer redemption backing.
If the issuer requires every swap to obey a band, this asset is ineligible for this pilot.

Use a relatively wide initial range and conservative allocation. Existing recentering is permissionless,
same-width and centered on **spot near the mark**, only near a range edge; a new appraisal alone does
not trigger it (core `:453-515`). A keeper may call that existing method, but gains no override.
At stale/deviant prices, existing liquidity can still trade until exhausted/out of range. Pausing the
engine does not remove it, and there is no owner-wide emergency LP recall in the exposed core lifecycle
(core `:307-329,368-399,446-521,644-652`). Do not promise autonomous withdrawal on an oracle alarm.

## 3. Token compliance survives; share eligibility is separate

**Decision:** rely on the issuer token's transfer enforcement and admit only a token whose custody
rules permit the complete engine path. The demo checks both nonzero transfer endpoints against
`permittedHolder OR registry.isVerified` (`contracts-v4/src/rwa/testnet/MockPermissionedPropertyToken.sol:52-59`).
Engine and adapter transfers do not bypass this check. “ERC-3643-shaped” is not certification:
real issuer freeze, agent, recovery and compliance-module behavior is **unverified** until exercised
against that issuer's exact testnet implementation.

Required property-token enrollment for the proposed topology:

| Address | Enrollment / verification requirement |
|---|---|
| Issuer inventory wallet and every property contributor/seller | Permitted or registry-verified; removing verification alone does not revoke a wallet still on the permitted list. |
| Engine instance | Enroll: receives contributions, supplies/recalls the property adapter, settles with PoolManager, pays exit recipients. |
| Property-side `MintwareIdleYieldAdapter` | Enroll: holds property; engine↔adapter transfers are checked. |
| PoolManager | Enroll: holds pool property and pays engine/trader recipients. This is shared infrastructure, not a pool-specific identity. |
| Every buyer and in-kind withdrawal recipient | Verify (or explicitly permit); quote-only LPs must understand they may need an eligible property recipient to exit fully. |
| DemoSwapRouter | Enroll for the retained demo route: sells transfer property user→router→PoolManager; buys deliver PoolManager→user. |
| Other router/intermediate custodian | Enroll only if it actually receives or sends property; verify any token-specific spender rules separately. Do not blanket-enroll arbitrary routers. |
| Quote adapter and quote ERC-4626 source | No property enrollment: neither holds property in this design. Apply the quote token's own restrictions independently. |
| Lifecycle module, appraisal mark, registry, owner/guardian/keeper acting only as callers | No property enrollment: they do not hold it; the module executes by delegatecall as the engine. |

Evidence for these edges: core `:267-283,663-665,711-735`;
`contracts-v4/src/vaults/MintwareIdleYieldAdapter.sol:120-145`;
`contracts-v4/src/vaults/MintwareMarketLifecycleModule.sol:18-21,43-87,121-165`;
`contracts-v4/src/rwa/testnet/DemoSwapRouter.sol:40-78`.
The old script enrolled only PoolManager, its actor and router; the property adapter is a new enrollment
(`contracts-v4/script/DeployRwaLiquidityUnit.s.sol:103-106`).

**Do not inherit “LPs never touch property.”** Withdrawals pay both assets in kind. Engine shares are
plain ERC-20 and quote-only contributions do not check the contributor's property identity
(core `:36,267-303,521-530`; wrapper `contracts-v4/src/vaults/MintwareMarketEngine.sol:10-18`).
Thus underlying ownership checks do not constrain economic exposure through transferable MWMS shares.
A revoked share owner can specify another permitted recipient; the transfer is engine→recipient,
not share-owner→recipient (core `:528-530,663-665`). Require issuer acceptance of this pooled-share
model before activation. If share-holder restrictions are required, do not launch this asset or add
an RWA wrapper to conceal the mismatch. A UI allowlist cannot fix unrestricted on-chain shares.

Failure and exit behavior to demonstrate, not hand-wave away:

| Failure | Current behavior and recovery recommendation |
|---|---|
| Trader/property holder revoked | Their property transfers fail. This does not by itself block engine recentering or other holders' exits. Reverify through the issuer; do not bypass the token. |
| Withdrawal recipient revoked | Property delivery fails. With a fresh mark, spot agreement, readable accounting and compatible output minimums, quote may be paid and shares retained for undelivered value. Otherwise the transaction reverts. Choose an issuer-approved eligible recipient or restore eligibility. |
| Property adapter revoked/frozen | Recall can return zero; incomplete custody retrieval scales both payouts to the least deliverable fraction. If property delivery fraction is zero, quote payout can also become zero. Restore adapter eligibility and retry. |
| Engine or PoolManager revoked/frozen | Recenter can revert atomically on token settlement. LP withdrawal can fail as a bucket; **fee collection occurs before isolation** and can revert the whole exit when property fees cannot transfer. No unconditional quote escape exists. |
| Stale mark plus any incomplete delivery | `ExitMarkUnavailable`; no grace-based stale valuation. Restore a valid mark and transfer path. Complete delivery can still work without a mark or spot agreement. |
| Source/accounting view unavailable | Adapter NAV reads can revert the whole exit even where recall itself is best-effort. Restore source reads; do not substitute a made-up valuation. |

Evidence: core `:534-567,573-637,675-703,762-773` and lifecycle module `:110-165`.
The recipient-failure path burns marked value delivered; adapter/LP shortfalls use a common deliverable
fraction. Retained shares remain a portfolio claim, not a segregated claim to specific frozen tokens.
Minimum-output failures roll back the transaction (core `:597-639`).

Engine pause does not gate `withdraw` (core `:521-525`), but token freezes can brick it.
Exit recovery is issuer restoration of permissions, followed by normal in-kind withdrawal; any issuer
forced-transfer/recovery facility is **unverified**, and cannot be assumed to preserve pool accounting.
Keep the old engine discoverable and shares visible while blocked. Do not revoke infrastructure until
all property balances and LP obligations are reconciled. A revoked ordinary user must not be enrolled
as infrastructure as a workaround.

## 4. Idle assets use the existing source slots

**Decision:** property uses the existing idle-custody adapter; quote uses the existing
`MintwareERC4626YieldAdapter` over a testnet ERC-4626 source. For the first deterministic rehearsal,
reuse `contracts-v4/test/mocks/MockERC4626.sol:12-36`, funded explicitly with valueless dUSD and labelled
simulated. Do not port the old APR-minting adapter. If no suitable source is deployed, explicitly select
zero source/idle custody and show “held ready”; no invented yield and no custom lending integration.

This is already a deployment choice: source zero selects idle custody; nonzero source must have the
matching `asset()` (`contracts-v4/script/lib/MarketEngineAdapterDeployment.sol:15-29`). Each engine gets
two dedicated adapters, bound once (core `:207-220`). The ERC-4626 adapter supplies to its source,
values shares with `previewRedeem`, and recalls best-effort
(`contracts-v4/src/vaults/MintwareERC4626YieldAdapter.sol:108-166`). Binding/source selection is not
hot-swappable; moving from an idle-only installation to a different source needs a new generation.

There is no “idle senior USD”: all balances back the same share. Amounts above `adapter.maxSuppliable()`
stay as engine cash; an actual supply failure reverts (core `:728-745`). Source loss, fees or limited liquidity affect that claim. The quote-source
mock can demonstrate those mechanics, not an expected return. Keep “one engine per asset:
liquidity → collateral → credit” as sequencing: this document implements only liquidity. A future
collateral consumer may read the mark, but must choose its own age, haircut and liquidation policy.

## 5. Retire the demo stack and make the RWA page a market view

**Decision:** archive historical proof data and remove obsolete executable paths after reconciliation.
Archive means preserved in Git history/an archive ref, excluded from active imports and compilation;
moving all old Solidity into another compiled directory would not simplify the system.

| Current artifact | Fate in the implementation follow-up |
|---|---|
| `contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol` | Delete after extracting mark controls and porting MW-03 tests. No hook deployment, dynamic band fees or actor-only LP gate. |
| `contracts-v4/src/rwa/testnet/DemoLendingAdapter.sol` | Delete; current simulated interest minting (`:56-85`) is replaced by a standard source fixture through the existing adapter. |
| `MockPermissionedPropertyToken.sol`, `MockRwaIdentityRegistry.sol`, `DemoUSD.sol`, `interfaces/IRwaIdentityRegistry.sol` under `contracts-v4/src/rwa/` | Keep unchanged as testnet token/identity fixtures, not engine dependencies. Keep their explicit mock status. Token checks and registry expiry remain issuer-side (`MockPermissionedPropertyToken.sol:52-59`; `MockRwaIdentityRegistry.sol:29-37`). |
| `contracts-v4/src/rwa/testnet/DemoSwapRouter.sol` | Keep unchanged as a test harness; it accepts a supplied PoolKey and uses ordinary v4 swaps (`:40-78`). A production router integration is not part of this ticket. |
| `contracts-v4/test/rwa/MockRwaLiquidityVault.sol`; `contracts-v4/script/DeployRwaLiquidityUnit.s.sol` | Delete the hook actor and its installer after replacing their scenarios with engine integration tests and the canonical installer. Current relationship is explicit at script `:18-23,97-116`. |
| `contracts-v4/test/rwa/MintwareRwaLiquidityUnit.t.sol`; `contracts-v4/test/audit-2026-10-31/RollingDrift.t.sol` | Rewrite/retarget applicable tests; preserve refusal and rolling-window coverage, retire hook-only expectations. |
| `config/rwaDemo*.json` | Preserve old addresses, snapshots and transaction hashes as historical artifacts; remove them from active RWA discovery. No rewriting old proof transactions as engine transactions. Current import and historic XRPL status: `lib/rwa/demo.ts:1-7`. |
| `lib/rwa/demo.ts`, `/api/rwa/unit`, RWA activity/appraisal scripts | Replace the Treasury/hook binding with registry resolution and mark publication; remove hook-only refresh and band sizing assumptions. Current reads: `app/api/rwa/unit/route.ts:27-49,132-141`; `lib/rwa/liveTrade.ts:51-58`; `scripts/rwa-refresh-appraisal.mjs:28,55-73`. |
| `/v1/rwas`, detail/proof/how views, `components/rwa/*`, issuer console | Keep routes and useful presentation; replace data model and copy with one engine share, in-kind exits and dated mark. Remove first-loss, lock and simulated APR counters (`components/rwa/RwaMarket.tsx:71-85`; `RwaIssuerConsole.tsx:29-56`; `RwaVisuals.tsx:131-163`). |

Do not count removal of Treasury contracts as new savings: the current installer already replaces
Treasury with a mock actor, although UI metadata still names it (`lib/rwa/demo.ts:121-128`;
`contracts-v4/script/DeployRwaLiquidityUnit.s.sol:18-23`). Never resurrect it to perform the migration.

Proposed `/v1/rwas` read contract: select curated engine rows by asset metadata, resolve explicit
`chainId + poolId + engineAddress`, and use the existing market/share readers. Extend their shared ABI
for missing views rather than inventing a second RWA state service. Registry verification currently
checks codehash, owner, quote, activation, tokens and pool identity; it does **not** independently certify
the issuer or mark (`lib/gateway/marketEngine.ts:24-59`). Curators must additionally verify mark/source
bindings, token permission topology and the exit rehearsal; record those checks as curation metadata.
Current verification allows one expected quote per chain (`lib/gateway/marketEngine.ts:27-29,51-55`).
To coexist with other Base Sepolia markets, extend this shared verifier to accept a curator-approved
per-instance expected quote, retaining the chain default for existing instances. Do not derive the
allowance solely from the candidate engine's own response. This is a small generic curation change,
not an RWA registry or a reason to replace the chain's existing quote setting globally.

| Screen value | Replacement source / meaning |
|---|---|
| Total value and user's share | `totalNav`, `totalSupply`, `balanceOf`; quote-denominated appraisal NAV, not cash realizable on exit. Uncollected fees are excluded (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:238-243`). Existing ABI: `lib/web3/artifacts/marketEngine.ts:8-12`. If NAV fails, show unavailable and retain share balance/exit controls. |
| Inventory location | Engine raw token balances, each adapter's `totalAssets`, `positionLiquidity`, range and pool spot; derive token amounts with shared position math. Core NAV composition: `contracts-v4/src/vaults/MintwareMarketEngineCore.sol:789-815`. |
| Appraisal | Mark `latestMark`, signer, report hash/date and publication history. Compute freshness against verified engine installation parameters. `maxMarkAge` and deviation are internal immutables, so expose deployment metadata, not nonexistent getters (core `:79-80`). |
| Price/range | PoolManager spot; engine `tickLower/tickUpper`; engine action tolerance as a separate overlay. No “hard floor”, band-fee or “trading halted on stale” status. |
| Operations/proof | Engine contribution/withdrawal/recenter/fee events, mark events and standard pool Swap events. Do not filter all trading to the demo router as the old route does (`app/api/rwa/unit/route.ts:163-184`). |
| Availability | Engine pause/activation, mark age, identity status of relevant endpoints, source liquidity and output simulation. Display failures as failures, not zero balances. |

Keep one-block-pinned state reads and distinguish live/cached/historical data; the old API already pins
reads and falls back independently (`app/api/rwa/unit/route.ts:127-151,224-228`). Historical snapshots must
not appear fresh. Replace the old `vault.seniorUsd/juniorUnits/lockExpiry` response shape and status labels
(`components/rwa/useRwaUnit.ts:14-19,70-78`). `/api/rwa/unit` may remain a thin compatibility endpoint
temporarily, but must delegate shared engine reading and disappear if no caller needs it.

## 6. Ordered migration and testnet deployment

These are acceptance steps for the later implementation PR, not actions performed by this design ticket.

1. **Inventory and freeze new demo activity.** Snapshot the old Base Sepolia balances, claims, pool,
   permissions and deployment hashes. Compare live bytecode with its recorded build, including MW-03.
   Stop old automation/new issuance without disabling legitimate recovery. Pass: balance reconciliation
   and a reproducible old-exit rehearsal; deployed state is unverified until this step runs.
2. **Implement only the mark and integration changes.** Reuse the shared core/module/adapters unchanged.
   Port rolling-drift tests: window boundary, each move expiry, reversal, heartbeat/outage and model fuzz.
   Add wrong signer, early rotation, rotation without budget reset, invalid dates, stale reports,
   token-order/decimal conversion and genuine outsize-appraisal rejection cases. Pass: exact errors,
   conversion vectors and no new dependency on a pool hook.
3. **Exercise engine composition locally.** Fresh contributions; stale/deviant entry and recenter refusal;
   ordinary swaps outside action tolerance succeeding; full in-kind exit while stale; incomplete exits
   requiring fresh mark/spot; each revoked endpoint separately; revoked share owner choosing a permitted
   recipient; frozen engine/PoolManager with nonzero fees; source recall/view failure; output minimums and
   retained-share value. Pass: observed outcomes match §3, with no assertion that every exit succeeds.
4. **Initialize a new hookless Base Sepolia pool.** Reuse token/identity fixtures where safe; publish a
   reviewed first mark; initialize the static-fee pool at its correctly oriented appraisal. Hook address
   participates in PoolKey, so this is a new pool identity, not an in-place hook removal
   (`contracts-v4/script/DeployMarketEngine.s.sol:113-119`; `lib/gateway/marketEngine.ts:46-55`).
5. **Install inactive with the canonical script.** Use chain 84532 and `MARKET_TEST_ONLY=true`, verified
   lifecycle module, new non-quote mark, dUSD quote source and zero property source. Installer supports
   this testnet and leaves the engine inactive (`contracts-v4/script/DeployMarketEngine.s.sol:58-74,82-100,141-175`).
   Accept ownership handoff, enroll the engine/property adapter/PoolManager/router, verify each transfer
   edge, source asset and module codehash. Pass: exact configuration and identities verified before activation.
6. **Activate, seed and rehearse.** Owner activates; issuer and test LPs contribute using nonzero minimum
   shares. Seed both sides, then use existing bounded `deployLiquidity`; no automatic property acquisition
   is assumed. Execute normal and failure cases on testnet with decoded receipts. Pass: correct NAV/share
   accounting, measured token outputs and preserved claims on refused operations.
7. **Curate and switch UI.** Register the new generation, explicitly configure quote/codehash expectations,
   wire shared reads and replace band/tranche copy. Pass: live block and source labels, unavailable-NAV
   behavior, both exit assets, permission errors and historic proof separation all verified.
8. **Opt-in asset migration and retirement.** Old holders exit under the old contract's actual terms; only
   received assets enter the new engine. No senior/junior-to-MWMS conversion ratio or forced migration.
   Keep old recovery available until balances/obligations are reconciled; archive old configs and remove
   unused source/scripts only then. Pass: new registry points to the engine, old balances remain accounted
   for, no active Treasury/hook readers, negative code delta. No push or deployment is part of this ticket.

### Change size and audit boundary

Measured baseline nSLOC = nonblank Solidity lines after removing line/block comments, including imports
and braces; excludes vendor dependencies. Counts below are local source measurements, not bytecode sizes.
Additions are estimates/budgets to verify during implementation; do not claim them as measured savings.

| Scope | Added | Removed | Net |
|---|---:|---:|---:|
| New `IssuerAppraisalMark` replacing hook | 180–240 | 348 (`contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol`) | −168 to −108 |
| Delete simulated lending adapter | 0 | 68 (`contracts-v4/src/rwa/testnet/DemoLendingAdapter.sol`) | −68 |
| Retire hook actor and installer; add small mark/fixture setup around canonical installer | 40–70 | 34 + 110 (`contracts-v4/test/rwa/MockRwaLiquidityVault.sol`; `contracts-v4/script/DeployRwaLiquidityUnit.s.sol`) | −104 to −74 |
| **Solidity subtotal, excluding rewritten test suites** | **220–310** | **560** | **−340 to −250** |

Core, wrapper, lifecycle, mark interface and both existing adapter implementations: **zero changes**.
One new runtime contract type; two obsolete runtime types removed; one test actor and one script retired.
Existing mocks/source fixture remain; deployed instances of reused contracts do not add source code.
Budget test-suite replacement at roughly neutral to +150 nSLOC, keeping the total Solidity change negative.
Measure TS/TSX/scripts separately: replace duplicate readers and remove obsolete automation, target net
nonpositive. Do not count archived history, already-deleted Treasury code or data JSON as source savings.
If budgets fail, shrink scope before introducing another abstraction.

Review the new mark and full composition: manipulated assessments, conversion rounding, rolling history,
signer rotation, permissioned settlement, share eligibility and partial exits. Existing engine checks
remain mandatory; this document does not certify the engine or token. Run the existing engine,
adapter and MW-03 regression suites plus the new integration tests and build-size checks in that PR.

## Open questions for the owner

1. Does the issuer accept transferable pooled shares and eligible-recipient in-kind exits? If not, defer this asset.
2. Is the removal of swap-level price limits acceptable, including trading against resting liquidity during stale marks?
3. Who owns the appraisal signing/rotation roles, and what report cadence and tolerance should replace rehearsal settings?
4. What concrete issuer procedure restores frozen infrastructure, and which testnet identity/token implementation will prove it?
