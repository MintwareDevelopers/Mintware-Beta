# RWA unit: our hooked v4 pool + the shared MarketEngine

Design revision · 2026-10-31 · Base Sepolia only · fictional property and valueless testnet capital. Recommendations below are not implemented. This
ticket edits only this document; leave it uncommitted. Local code citations use `0ab16fc8f1caa118c2925599e7ca184a1b936b08`. Historical references name
their commit. `UP/` means the read-only Uniswap/v4-periphery checkout at `3245c3cb99c48fa1dc2459c3b60abc37d4294aba`, rooted at
`/private/tmp/claude-501/-Users-nicolasrobinson-Downloads-Mintware-Phase-1-app-Build/64707850-7e75-4cb8-9675-26b3c1918aff/scratchpad/v4-periphery`.
Its paths are also accessible in the [pinned source tree](https://github.com/Uniswap/v4-periphery/tree/3245c3cb99c48fa1dc2459c3b60abc37d4294aba). Live
deployments, Base Sepolia standard-periphery availability, bytecode sizes and integration outcomes are **unverified**. Source compatibility is not
deployment verification or an audit of our composition.

## Recommendation and precedents

Keep one MarketEngine per RWA asset, LPing into **our own hooked v4 pool**. Third-party pools retain the hookless route; every pool Mintware creates
carries our hook. The engine owns capital and claims; the hook owns pool rules. Recommend Uniswap Permissioned Pools for compliance plumbing, one
combined permission/appraisal hook, existing Base Sepolia USDC, and permissioned, non-transferable RWA shares. Reuse the shared engine accounting with
an explicit pool-currency/settlement-asset mapping. Do not add another capital vault, NFT position owner, oracle contract, token ledger or lending
implementation.

### Precedents

| Precedent and verified source | Pattern to adopt / limit |
|---|---|
| Uniswap Permissioned Pools: [July 2026 introduction](https://blog.uniswap.org/es-ES/introducing-permissioned-pools-on-uniswap-v4), [August explanation](https://blog.uniswap.org/how-permissioned-pools-work-on-uniswap-v4), [deployment guide](https://developers.uniswap.org/docs/protocols/uniswap-labs-hooks/permissioned-pools/deploy-a-permissioned-pool) | Standard adapter, issuer permissions, trusted routing and non-transferable LP positions. Use these interfaces and settlement semantics; our engine remains a custom position owner. The supplied older `.md` URL did not resolve; this is the current guide. |
| Aave Horizon: [market documentation](https://aave.com/docs/aave-v3/horizon), [NAVLink launch](https://aave.com/blog/horizon-launch) | Permissioned collateral, non-transferable collateral receipts, permissionless stablecoin lending and bounded issuer NAV feeds. Template for later collateral/credit, not a reason to add lending now. Aave reports over $570M supplied at end-2025 in its [year review](https://aave.com/blog/aave-2025-recap); ~$550M is not a verified current figure. |
| Ondo Global Markets: [overview](https://docs.ondo.finance/ondo-global-markets/overview), [mint/redeem liquidity](https://ondo.finance/blog/what-sets-ondo-stocks-apart), [redemption constraints](https://docs.ondo.finance/ondo-stocks/investing-and-redeeming), [Chainlink feeds](https://docs.chain.link/data-feeds/tokenized-equity-feeds/ondo) | Separate issuer primary liquidity and reference valuation from secondary execution. Feed values incorporate token economics, not simply stock spot. Aggregator routing is distribution, not extra backing; the specific current aggregator integration was not verified here. Do not import a securities issuer's redemption promises into a property demo. |
| RealT: [Aave forum risk assessment, July 2025](https://governance.aave.com/t/temp-check-add-armmwxdai-realt-rmm-xdai-deposit-token-to-aave-v3-gnosis/22378/7) | Aave-fork lending plus a peer-to-peer order book. The assessment reports $32,284 aggregate YAM liquidity across 724 tokens **as of June 27, 2025**, not today's depth. Inference: property appraisal and AMM exit liquidity must be shown separately. |

The appraisal band, rolling drift and grace window are **Mintware-specific policy**, not requirements of Permissioned Pools or features certified by
these precedents. Retain them because the owner explicitly requires appraisal-governed trading. Independent NAV and bounded updates have precedent;
the exact tick limits still require testing. A band cannot create buyers or issuer redemption backing.

Prior-work harvest remains: shared capital/lending seam without tranches (`bbdd22033:docs/developers/target-architecture.md:13-23`); explicit
activation and transfer/exit qualification (`1a4e18956:docs/product/platform-architecture-adjudication-2026-10-28.md:220-254`); direct PoolManager
positions and bound adapters (`3c977d0d5:docs/developers/v2/DECISIONS.md:10-13,37`). Keep the existing appraisal controls from
`.claude/rules/rwa-liquidity.md:15-25`, replacing its Treasury and quote-only-exit assumptions. The local installer already uses a mock actor, not
Treasury (`contracts-v4/script/DeployRwaLiquidityUnit.s.sol:18-26,97-116`).

## A. Adopt the standard compliance layer, with its actual custody model

**Yes: use the upstream PermissionsAdapter, issuer-supplied IAllowlistChecker and permissioned-router build.** Do not implement another wrapper token
or maintain Mintware's own identity registry. Reuse an issuer checker across assets where appropriate; a small stateless bridge to the issuer's
existing eligibility API is acceptable when required. It must implement ERC-165 and return the standard flags
(`UP/src/hooks/permissionedPools/interfaces/IAllowlistChecker.sol:7-12`; `UP/src/hooks/permissionedPools/libraries/PermissionFlags.sol:22-26`). No
second eligibility database.

**Correction to the proposed premise: the engine will not hold the adapter token.** Only PoolManager holds that virtual ERC-20. Allowed wrappers can
mint it *to PoolManager*, backed by underlying already sent to the adapter. A PoolManager transfer burns the received virtual tokens and delivers the
underlying to the recipient (`UP/src/hooks/permissionedPools/PermissionsAdapter.sol:44-55,96-125`). This is not a freely circulating, redeemable
wrapper balance that an idle adapter can hold. The upstream regression asserts automatic unwrap and underlying receipt
(`UP/test/hooks/permissionedPools/PermissionsAdapter.t.sol:202-216`).

The adapter's `allowedWrappers` gates **wrapping**, not ordinary user eligibility on every transfer. The hook/router checks permissions; the native
issuer token still enforces who may receive its underlying (`UP/src/hooks/permissionedPools/PermissionsAdapter.sol:45-49,74-75,100-125`;
`UP/src/hooks/permissionedPools/PermissionedV4Router.sol:25-44`). Standard adoption does not delete issuer compliance or all infrastructure
enrollment; it moves pool custody behind an issuer-approved adapter.

Verified upstream authority boundaries:

| Mechanism | What it authorizes |
|---|---|
| Adapter owner / issuer | Changes wrappers, checker and swap switch (`UP/src/hooks/permissionedPools/PermissionsAdapter.sol:59-75`). These are mutable authorities, not our hook's 48h timelock. |
| Factory verification | Records adapter → underlying after a positive underlying balance; it does not certify the issuer or hook (`UP/src/hooks/permissionedPools/PermissionsAdapterFactory.sol:22-46`). |
| `PermissionedPositionManager.isAllowedHooks[currency][hook]` | Adapter owner can approve any hook for that manager, including ours. Checked on mint/increase; decrease/burn remain available (`UP/src/hooks/permissionedPools/PermissionedPositionManager.sol:60-75,146-217`). This is not a global PoolManager allowlist. |
| `IMsgSender` plus trusted wrapper | Resolves the actual trading/liquidity principal; a claimed sender from an untrusted router is insufficient (`UP/src/hooks/permissionedPools/interfaces/IPermissionsAdapter.sol:71-74`; `UP/test/hooks/permissionedPools/mocks/MockPermissionedHooks.sol:140-160`). |

The current online guide shows `PermissionsAdapter.updateAllowedHook`, but that method is absent from the pinned adapter; this commit uses
`PermissionedPositionManager.setAllowedHook` above. Follow the pinned source and reconcile deployed ABIs before installation; do not copy the
conflicting snippet. The guide also requires a permissioned Universal Router build and separate routing onboarding; custom hook compatibility does not
establish inclusion in the Uniswap interface/API ([deployment
guide](https://developers.uniswap.org/docs/protocols/uniswap-labs-hooks/permissioned-pools/deploy-a-permissioned-pool)).

**Deletion effect:** retire DemoSwapRouter and its custom trade path, MockRwaIdentityRegistry and IRwaIdentityRegistry from the active implementation.
Replace the old property-token fixture with issuer fixtures; retain issuer-native enforcement. Also retire DemoUSD, simulated DemoLendingAdapter, the
mock LP actor and duplicate installer. Standard dependencies and any checker/test-fixture glue must be counted separately (§E); replacing handwritten
code with upstream code is not zero code or zero deployed contracts.

## B. One permission-compatible appraisal hook

**Yes, one contract.** Extend `MintwareRwaAppraisalHook` with standard permission checks and `IMarketAssetMark`; keep one appraisal history. A second
deployed hook needs a dispatcher because the PoolKey names one hook (`contracts-v4/script/DeployRwaLiquidityUnit.s.sol:87-94`). There is no benefit
here. The pinned checkout contains only `UP/test/hooks/permissionedPools/mocks/MockPermissionedHooks.sol`, whose own description calls it a standalone
replication (`UP/test/hooks/permissionedPools/mocks/MockPermissionedHooks.sol:20-21`); there is no production `PermissionedHooks.sol` under its
`src/`. Do not inherit a test mock or assert that a production base was audited.

Adapt the small permission kernel, not all 137 nSLOC of the mock:

| Callback | Required composition |
|---|---|
| Initialize | Require the pinned adapter/USDC key, at least one verified adapter, and reject registered-but-unverified adapters; then our fresh appraisal/core-band initialization checks. Reference: `UP/test/hooks/permissionedPools/mocks/MockPermissionedHooks.sol:49-64`; existing hook `contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:350-363`. |
| Before swap | Authenticate PoolManager/key; require the sender is an allowed wrapper, resolve `IMsgSender(sender).msgSender()`, require `SWAP_ALLOWED` and adapter `swappingEnabled`, then apply our freshness/pause/pre-swap band fee. Reference kernel: `UP/test/hooks/permissionedPools/mocks/MockPermissionedHooks.sol:67-82,140-160`. |
| Before add | Require the bound engine, its wrapper approval and `LIQUIDITY_ALLOWED` for the pooled principal. The standard checks one-sided liquidity too; a zero property contribution is not a compliance exemption (`UP/src/hooks/permissionedPools/PermissionedPositionManager.sol:142-165`). |
| Before remove / collect | Authenticate PoolManager, pinned pool and bound engine only. No current allowlist, wrapper approval, appraisal age, band or pause check; issuer token settlement can still refuse delivery. Upstream similarly leaves decreases/burns unchecked (`UP/src/hooks/permissionedPools/PermissionedPositionManager.sol:168-172`). |
| After swap | Keep our band/gap-closing checks; optionally emit the standard user-attributed Swap event for compatible indexing (`UP/test/hooks/permissionedPools/mocks/MockPermissionedHooks.sol:85-95`). |

Retain our `onlyPoolManager` and one-pool checks; the mock is not the security scaffold
(`contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:193-195,460-462`). Do not copy its unused callback reverts: it reverts in `beforeRemoveLiquidity`,
while our enabled removal callback must succeed for the engine (`UP/test/hooks/permissionedPools/mocks/MockPermissionedHooks.sol:102-108`;
`contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:174-190,376-381`). Budget 35–45 additional nSLOC for the permission kernel inside the hook,
including immutable references; exact size and router integration are unverified. A reusable internal helper is fine if duplication later warrants it;
no deployed permission dispatcher now.

For the direct-engine route, issuer `allowedWrappers[engine]` approves the engine's immutable pool/hook combination; hook additions must read that
approval each time. No extra per-hook registry is required. This is a deliberate integration choice, **not** enforcement of the PositionManager's hook
map: revoking that map alone cannot revoke our direct engine. Revoke its wrapper approval to stop new LP additions. Keep the bound-engine LP gate;
ordinary users join through engine shares, not permissioned position NFTs. The issuer must approve this capital owner and its recovery limits, not
merely the hook's source hash.

## C. Engine compatibility: direct LP is possible, but not with today's settlement

**Recommend retaining direct PoolManager positions and adding the standard wrapping payment sequence.** Allowlisting alone is insufficient. Today core
sets `token0/1` to pool currencies and checks the mark against that currency; contributions and idle balances consequently refer to those ERC-20s
(`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:136-157,173-195,267-283`). Settlement transfers that currency directly to PoolManager; exact
swap-output checks measure that currency's balance (`contracts-v4/src/lib/MWV4Settlement.sol:73-95`). Both assumptions fail for the virtual adapter
token.

Proposed asset model, without a new claim ledger:

| Layer | Property side | Quote side |
|---|---|---|
| Sorted PoolKey | PermissionsAdapter address | Existing Base Sepolia USDC |
| Engine `token0/1`, in the **same PoolKey order** | Underlying property token | USDC |
| Mark `asset()` / `quoteAsset()` | Underlying property / USDC | Quote is valued at one quote unit |
| Idle adapter, cash, contributions, payouts and measured receipts | Underlying property | USDC |
| LP amounts | Adapter raw units map 1:1 to underlying raw units | USDC raw units |

Resolve immutable settlement assets in the owned wrapper from the pinned factory and verify adapter PoolManager, underlying and decimals; require
standard non-rebasing, exact-transfer assets. Feed those assets into shared core construction and mark validation. Sort by **adapter/USDC**, never
re-sort by underlying/USDC: otherwise tick orientation, ranges and amount0/1 become wrong. The adapter copies underlying decimals with fallbacks, so
verify actual equality instead of trusting fallback metadata (`UP/src/hooks/permissionedPools/PermissionsAdapter.sol:153-158`). The ordinary wrapper
resolves identity mapping and retains its existing eligibility. No arbitrary caller-supplied token substitution.

In the shared lifecycle/settlement helper, for each negative permissioned-currency delta: `sync(adapter currency) → transfer exact underlying from
engine to adapter → wrapToPoolManager(amount) → settle()`. Positive deltas use `take(adapter currency, engine, amount)` and measure **underlying**
received. This mirrors the standard manager's underlying payment then wrap (`UP/src/hooks/permissionedPools/PermissionedPositionManager.sol:220-240`)
and the adapter's automatic unwrap. Preserve measurements and rollback; do not consume the adapter's verification seed/donations as free engine
capital. `wrapToPoolManager` only checks backing slack, not who funded it (`UP/src/hooks/permissionedPools/PermissionsAdapter.sol:45-49`). Pair each
wrap with measured engine funding.

Extend the shared measured-position path to accept this mapping; its current helpers measure supplied asset balances but settle using the unmodified
PoolKey (`contracts-v4/src/lib/MWV4PositionEngine.sol:29-78`). This covers add, remove, recenter and zero-delta fees. The module remains
stateless/delegatecalled and the engine remains the PoolManager position owner
(`contracts-v4/src/vaults/MintwareMarketLifecycleModule.sol:18-21,42-87,110-165`). Pin the rebuilt module hash in both reviewed wrappers; changing
libraries changes its bytecode. No cloned NAV/share/exit algorithm.

**Cut optional engine swaps from this first owned-pool variant.** Seed both underlying assets and override its existing virtual `_swapIdleExactIn` to
refuse; the shared hookless engine retains that feature (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:335-396`). This avoids adding a second
permissioned swap router and exact-output mapping now. It also removes the need for an engine swap exemption: all actual swaps obey the standard user
permissions and appraisal rules. Engine needs `LIQUIDITY_ALLOWED`, not `SWAP_ALLOWED` in this variant. If swaps are added later, neither permission
nor freshness may be bypassed by the old bound-actor exemption (`contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:386-411`).

Add `IMsgSender.msgSender()` on the owned wrapper, reporting the **engine as pooled principal**, not the permissionless recenter caller or
`tx.origin`. It acts for its own pool position, not as a public router; share issuance is checked separately (§D). No transient forwarded-user state
is needed for that identity. Trusted router sender resolution is still required for trades; a fake `msgSender()` must never establish trust.

Why not route the engine through PermissionedPositionManager? It is the simplest route for an individual standard LP, but this engine tracks a direct
position and scalar liquidity, not an NFT; the manager adds non-transferable NFTs and issuer-forced unwind
(`UP/src/hooks/permissionedPools/PermissionedPositionManager.sol:77-140`). That would require another position backend, tokenId/recenter handling and
accounting for external forced unwinds. The direct route reuses the standard adapter payment pattern with less new engine state. **It does not inherit
`unwindPosition` or ERC-6909 fallback recovery.** If the issuer requires these for pooled holders, defer this asset rather than describe the direct
engine as a complete standard deployment.

Keep a second thin `MintwareOwnedPoolMarketEngine`; the existing wrapper passes `allowHookedPool=false`
(`contracts-v4/src/vaults/MintwareMarketEngine.sol:10-18`). Core changes now exceed the previous two edits: asset resolution plus exact dynamic-fee
admission and an exit-price seam. For fees accept static values ≤1,000,000, or exactly `DYNAMIC_FEE_FLAG` with hooks explicitly allowed and nonzero;
our wrapper requires the sentinel. Current core rejects all higher values (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:132-144`); our hook
requires dynamic fees (`contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:350-359`). Do not mask flags. Make self-only `readPricesForExit` virtual,
retaining its default body for ordinary markets, so only the owned wrapper accepts the hook's grace age
(`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:668-672`).

**Curation must change for mapping, not quote exceptions.** The current verifier insists engine tokens match PoolKey currencies
(`lib/gateway/marketEngine.ts:37-55`). Version it by approved wrapper/build hash: identity mapping for third-party pools; verified adapter →
underlying mapping for our pools, plus exact hook/mark/engine/PoolManager binding. Preserve chain quote and owner checks, record issuer
wrapper/checker approvals, and keep one curated active generation per asset with retired exits addressable (`lib/gateway/marketEngine.ts:62-94`). Do
not turn a self-reported mode into an allowlist.

## Appraisal, binding and exits retained

One hook implements `IMarketAssetMark`, whose price is whole quote per whole asset scaled by `1e18` and timestamp is source observation time
(`contracts-v4/src/vaults/IMarketAssetMark.sol:4-19`). Bind it to underlying property and USDC, but derive tick orientation from adapter/USDC PoolKey.
Convert accepted appraisal ticks with integer TickMath/full-precision arithmetic, invert for property-as-currency1 and apply decimals; never use pool
spot as the mark. Test zero/overflow, both orders and unequal decimals.

| Hook control | Recommendation / current evidence |
|---|---|
| Step / publication interval | Retain one enforcement point (`contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:237-243`). |
| Rolling drift MW-03 | Retain cumulative absolute movement and individual 24h expiry, including reversals (`contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:244-260`); preserve all regression/model cases (`contracts-v4/test/audit-2026-10-31/RollingDrift.t.sol:23-82`). Deployed fix status unverified. |
| Keeper / config | Keep 48h keeper and post-launch config timelocks (`contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:61,296-331`). Freeze max age/grace at pool pin, checking both config proposal/confirmation; new policy ages need a new generation. |
| Observation provenance | Add `observedAt` and report hash to publication; retain publication time for rate/drift limits. Today only publication time is stored (`contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:222-264`). Reject missing/future/non-increasing observation dates; never rejuvenate old reports by heartbeat. |
| Band / fee | Keep pre-swap core/spec fee and post-swap band with same-side gap-closing exception (`contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:386-433`), after standard permission checks. |
| Source consumer | `latestMark` returns dated truth after binding even when stale. Engine uses ordinary max age; exit override alone uses age + grace through existing zero/future/stale validation (`contracts-v4/src/lib/MWMarketValuation.sol:23-35`). No duplicate oracle or limits. |

The source timestamp is the necessary additional state for dated NAV; report hash may be emitted rather than stored if no on-chain consumer needs it.
A feed-shaped interface does not make an issuer signature an independent appraisal. Future NAVLink integration must replace the source, not introduce
a second competing valuation history. Genuine outsize updates require pausing new risk and explicit review, never fabricated intermediate appraisals.
First appraisal remains unbounded against a predecessor (`contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:221-232`).

Resolve the existing deployment cycle: core requires an initialized pool, while hook initialization requires a bound deployed actor
(`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:177-184`; `contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:203-209,350-355`). Retain one-shot
owner-only `pinPoolKey`, now verifying adapter/USDC; authorize owner initialization, then deploy engine and bind with `setVault`. Require the same
key, PoolManager and mark when binding. Refuse swaps/LP before binding and make mark reads unavailable until bound so activation cannot precede
binding. This small custom pin avoids a placeholder actor or factory and preserves the initialized-pool invariant; an old bound hook cannot migrate.

| Action / age | Required outcome |
|---|---|
| Deploy / recenter | Engine permitted; add callback checks issuer permission. Recenter collects, removes and re-adds atomically; a revoked add rolls back the old position (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:453-490`). |
| Withdraw / harvest | Removal and zero-delta collection authenticate the engine but ignore current LP permission, band, freshness and pause. Collection uses zero liquidity delta (`contracts-v4/src/lib/MWV4PositionEngine.sol:84-100`); exact v4 callback dispatch is unverified in the absent local core dependency and must be asserted. |
| Fresh ≤ max age | Standard permissions, swaps, band fees and normal engine mark checks apply. |
| Max age < age ≤ max age + grace | Ordinary swaps/new risk stop. Full in-kind exits continue; partial valuation may use the hook's dated appraisal through the wrapper, with existing spot/minimum-output checks. |
| Beyond grace / unavailable mark | Full pro-rata delivery still needs no mark; incomplete delivery refuses until mark/delivery recover (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:534-540,597-637`). |

Current `oracleReady` has grace but engine does not consume it (`contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:267-281`;
`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:668-672,783-787`); grace-aware partial valuation is proposed. **A hook revert can trap exits:**
fee collection precedes isolated LP removal, so a collection revert aborts the whole exit; later removal failure becomes incomplete delivery
(`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:541-567`). Never add permission/age checks to those callbacks. Standard wrapper revocation must
block new wrapping, not unwrap; native-token freezes can still block engine delivery. No hook or standard adapter can promise unconditional quote
recovery.

Retain rehearsal bands 300/1000 ticks, step 500, interval 10 minutes, drift 1000/24h, max age 30 days, grace 7 days and fees 3000/10000 pips
(`contracts-v4/script/DeployRwaLiquidityUnit.s.sol:48-58`). Recommend small USDC cap, 20% LP cap, spacing-aligned initial ±1000-tick range, 1100-bps
action tolerance to cover that band's approximate price width. These are unvalidated test settings; prove boundaries and outsize appraisal moves.
Recenter remains same-width, spot-centered near an edge, with cooldown/movement bounds
(`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:453-515`). Idle recall is not emergency LP recall
(`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:307-329,643-650`). Caps do not insure losses.

## D. Enrollment, shares and failure behavior

**The standard does not fix MWMS.** Adapter permissions apply to its users/wrappers, not downstream ERC-20 claims. Current MWMS is transferable, and
quote-only issuance has no property-identity gate (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:36,267-303`). Putting an approved engine in
front of it would hide beneficial exposure behind one approved account, worsening the mismatch if left unchanged. Uniswap disables LP-NFT transfers
(`UP/src/hooks/permissionedPools/PermissionedPositionManager.sol:128-140`); Horizon uses non-transferable collateral receipts ([Horizon
documentation](https://aave.com/docs/aave-v3/horizon)).

**Recommend non-transferable shares for new RWA instances**, with `LIQUIDITY_ALLOWED` checked for every share recipient, including quote-only
contributors, and valid engine wrapper/LP approval on issuance. Implement this in the thin wrapper's ERC-20 update override: reject ordinary
transfers, check mint, allow burn for exits. No new share token, transfer allowlist or lock-state ledger. Do not gate all `_beforeShareChange` calls:
both contribution and withdrawal use it (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:254,527`). Hookless markets keep their current shares.
This follows the precedents with less state than transfer restrictions plus account-recovery machinery; it is still a proposal, not proof of issuer
compliance. Permissionless stablecoin lending remains a later separate claim; a quote contribution to this mixed-property LP portfolio is not that
product.

Recipients must satisfy the native token's rules. Revoked holders may burn shares to an issuer-approved eligible recipient; current delivery is engine
→ recipient, not holder → recipient (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:528-530,663-665`). Obtain issuer acceptance of this
recovery model. Non-transferability does not implement seizure, wallet recovery or mandatory forced exit.

| Actor | Enrollment in the proposed topology |
|---|---|
| PermissionsAdapter | Issuer-native underlying custody permission; owner/checker verified. This replaces PoolManager as underlying custodian. |
| Engine | Underlying transfer eligibility, `allowedWrappers=true`, `LIQUIDITY_ALLOWED`; fixed pool/hook and pooled-principal identity reviewed. |
| Property idle adapter | Underlying transfer eligibility; holds property, never virtual tokens. No wrapping permission needed. |
| Issuer / contributors / share recipients | Native eligibility where property moves, plus `LIQUIDITY_ALLOWED` for all share issuance. |
| Trader / output recipient | Router resolves caller's `SWAP_ALLOWED`; native token checks actual output recipient. Approving a caller does not waive recipient restrictions. |
| Permissioned Universal Router | `allowedWrappers`; native eligibility if its selected route ever holds underlying. Check the actual route, not just the label. |
| PoolManager | Holds virtual adapter currency and USDC; no property-token enrollment for this flow. |
| Quote adapter / ERC-4626 source | Quote restrictions only. |
| Hook / module / checker / callers | No custody enrollment solely for calling; lifecycle calls execute as engine. |

Evidence for wrapper/unwrap edges: `UP/src/hooks/permissionedPools/PermissionsAdapter.sol:44-49,100-125`; router payment:
`UP/src/hooks/permissionedPools/PermissionedV4Router.sol:25-44`; engine/idle edges:
`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:267-283,663-665`; `contracts-v4/src/vaults/MintwareIdleYieldAdapter.sol:120-145`. This table
replaces the old direct-token PoolManager/router enrollment, not the issuer's native compliance checks.

| Failure | Required behavior / recovery |
|---|---|
| Trader / new contributor revoked | Swaps or new shares refuse; neither a router identity nor quote-only funding bypasses the checker. Restore issuer authorization. |
| Engine wrapper / LP permission revoked | New wrapping/additions/issuance refuse; remove/collect do not recheck it. Recenter re-add failure rolls back. Native delivery eligibility is a separate condition. |
| Recipient revoked | Property leg may fail, quote may deliver with retained shares only under valid partial valuation/spot/minimum conditions (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:607-639`). Restore eligibility or use issuer-approved recovery recipient. |
| Engine / permissions adapter frozen by token | Underlying delivery or fee collection may abort the whole exit. Restore issuer-native permissions; no automatic PositionManager fallback for a direct position. |
| Property idle adapter frozen | Recall can return zero; common deliverable fraction can reduce quote payout to zero too (`contracts-v4/src/vaults/MintwareIdleYieldAdapter.sol:139-145`; `contracts-v4/src/vaults/MintwareMarketEngineCore.sol:573-605`). |
| Stale mark or divergent spot + incomplete delivery | Grace only extends valuation age, not spot tolerance or asset availability. Beyond grace refuse incomplete exit; complete in-kind delivery remains mark-independent (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:534-540,597-637`). |
| Source NAV read failure | May abort the entire exit despite best-effort recall; restore readable accounting (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:762-773`). |
| Hook/checker unavailable | New risk fails closed. Removal must avoid checker calls, but a broken collection callback still traps exit; test explicitly (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:541-567`). |

Both assets exit in kind. Undelivered value retains portfolio shares, not a segregated frozen-token claim; minimum-output failure rolls back
(`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:573-639`). Engine pause does not gate withdrawal
(`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:521-525`). Keep old claims visible and infrastructure enrolled until reconciled; issuer forced
transfer is unverified and may break accounting. Do not enroll revoked users as infrastructure to evade policy.

## Quote, idle slot, deletion list and /v1/rwas reads

Keep Base Sepolia USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, the documented existing `MARKET_ENGINE_QUOTE_ASSET_84532`
(`scripts/ops/relaunch-base-market.sh:18-23`). Verify live env/decimals at preflight. No dUSD or per-instance quote exception; chain quote validation
stays (`lib/gateway/marketEngine.ts:27-29,51-55`). Price appraisal in USDC terms; do not silently equate USD reports with a deviating quote token. The
currency-mapping verifier change in §C is nevertheless required.

Underlying property uses the existing idle adapter. USDC uses the existing ERC-4626 adapter only with a verified testnet source; otherwise source zero
means “held ready”. The helper already chooses these and checks source `asset()` (`contracts-v4/script/lib/MarketEngineAdapterDeployment.sol:15-29`).
Rehearsal may fund `MockERC4626` with testnet USDC and explicitly simulated donations (`contracts-v4/test/mocks/MockERC4626.sol:12-36`). No custom
rate-minting venue. One-time adapter bindings, `previewRedeem` NAV and best-effort recall remain; source changes need a new generation
(`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:207-220`; `contracts-v4/src/vaults/MintwareERC4626YieldAdapter.sol:108-166`). Capacity excess
stays cash; actual supply failure reverts (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:728-745`). Source loss affects every share.

| Artifact | Disposition in implementation |
|---|---|
| Appraisal hook | Retain/extend; remove old actor-swap bypass for this variant. No separate mark or deployed permission hook. |
| `src/rwa/testnet/DemoSwapRouter.sol` | Delete; its current raw-currency settlement cannot wrap adapter input (`contracts-v4/src/rwa/testnet/DemoSwapRouter.sol:40-78`). Use permissioned routing; no claim of automatic UI/API listing. |
| `src/rwa/testnet/MockRwaIdentityRegistry.sol`, `src/rwa/interfaces/IRwaIdentityRegistry.sol` | Retire Mintware's identity facade (`contracts-v4/src/rwa/testnet/MockRwaIdentityRegistry.sol:13-37`); issuer checker/native token remain authoritative. |
| `src/rwa/testnet/MockPermissionedPropertyToken.sol` | Replace with issuer testnet implementation/fixtures after qualifying actual transfer behavior. Existing both-endpoint gate is useful negative-test coverage (`contracts-v4/src/rwa/testnet/MockPermissionedPropertyToken.sol:52-59`). |
| `src/rwa/testnet/DemoUSD.sol`, `DemoLendingAdapter.sol` | Delete custom stablecoin and simulated minting venue (`contracts-v4/src/rwa/testnet/DemoLendingAdapter.sol:56-85`). |
| `test/rwa/MockRwaLiquidityVault.sol`, `script/DeployRwaLiquidityUnit.s.sol` | Delete actor/duplicate installer after engine composition tests; harvest CREATE2 hook mining into canonical setup (`contracts-v4/script/DeployRwaLiquidityUnit.s.sol:76-110,133-147`). |
| RWA tests / RollingDrift | Preserve scenarios; use actual standard adapter/router and engine. Upstream mocks have public setters and only recipient token checks (`UP/test/hooks/permissionedPools/PermissionedPoolsBase.sol:25-52`); local test fixtures are not deployment-grade issuer contracts. |
| `config/rwaDemo*.json`, legacy readers/scripts/UI | Archive original facts/hashes. Replace active Treasury/rate readers (`app/api/rwa/unit/route.ts:27-49,132-141`), metadata (`lib/rwa/demo.ts:121-128`) and same-tick refresh (`scripts/rwa-refresh-appraisal.mjs:65-75`). Keep dated appraisal/band views and proof history. |

Paths abbreviated `src/`, `test/`, `script/` in this table are under `contracts-v4/`. Archive in history, not another compiled folder; reconcile
claims before deleting executables. Count no already-retired Treasury as new savings. No new collateral/credit integration in this migration.

`/v1/rwas` remains a view of curated engines: resolve `chainId + poolId + engineAddress`, preserving inactive generations
(`lib/gateway/marketEngine.ts:70-94`). Extend shared readers rather than a second RWA state service; `/api/rwa/unit` may temporarily delegate. Read
contract:

| Screen value | Required source / semantics |
|---|---|
| Asset identity | Show underlying property and USDC, plus distinct virtual PoolKey currency and verified adapter provenance. Use pool ordering for ticks; no generic token0=currency0 assumption. |
| NAV / user claim | Engine NAV, supply/balance and non-transferable status. NAV excludes uncollected fees (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:238-243`); it is not realizable cash. Keep share/exit controls if NAV fails. |
| Location | Underlying engine/idle-adapter balances plus engine LP amounts. Do not count the permissions adapter's global backing as this engine's NAV; current portfolio composition is engine assets plus its position (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:789-815`). |
| Appraisal / pool rules | Hook mark/source date/report, keeper/pending changes, core/spec bands, actual fee rule, pause and grace; show gap-closing exception. |
| Eligibility / exits | Native recipient eligibility, LP/swap flags, engine wrapper approval, source availability; distinguish full in-kind from conditional partial exits. Internal age/tolerance need verified install metadata (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:79-83`). |
| Proof / history | Engine + hook + all pool Swap events; remove old router-only filtering (`app/api/rwa/unit/route.ts:163-184`). Original demo transactions stay historical. |

Keep block-pinned reads and separate live/cached/recorded fallbacks (`app/api/rwa/unit/route.ts:127-151,224-228`); label actual state block, not head
when reading head−1 (`app/api/rwa/unit/route.ts:129,199-200`). Failures are unavailable, not zero.

## E. Ordered migration and honest size budget

1. Snapshot old claims/balances/permissions, bytecode and proofs; verify deployed MW-03 independently. Stop new demo activity without disabling
   recovery. No automatic tranche-to-MWMS or dUSD-to-USDC conversion.
2. Qualify issuer token/checker and Base Sepolia standard factory/router builds. The guide lists Ethereum mainnet and Sepolia, not proof of Base
   Sepolia availability ([deployment
   guide](https://developers.uniswap.org/docs/protocols/uniswap-labs-hooks/permissioned-pools/deploy-a-permissioned-pool)). Reproduce pinned builds or
   deploy official source on Base Sepolia testnet; do not substitute generic Universal Router or deploy `MockPermissionedHooks`. Resolve missing
   production/router sources first.
3. Implement shared asset mapping/settlement, owned wrapper, permission kernel and single mark. Disable owned-engine swaps, gate mints and disable
   share transfers. Preserve ordinary-wrapper behavior. Update module hashes, installer and versioned verifier; current installer hardcodes no
   hook/static fee bounds (`contracts-v4/script/DeployMarketEngine.s.sol:102-141`). Measure actual source/build deltas before rollout.
4. Prove integration with the pinned standard: swap-only vs LP-only accounts, fake router identity, quote-only issuance, approval/checker revocations,
   verified/fake adapters, both token orders, underlying balance measurement, zero residual adapter balances outside PoolManager, seed/donation
   isolation and exact funding. Test deploy/recenter/collect/withdraw and all failures in §D, especially revoked wrapper exits, frozen underlying with
   accrued fees, source NAV failures, fresh/grace/expired marks, output minima and retained shares. Keep all MW-03, band, fee, timestamp and timelock
   regressions; assert exact errors.
5. Create the standard adapter via factory, native-enroll it, make the verification transfer and verify mapping
   (`UP/src/hooks/permissionedPools/PermissionsAdapterFactory.sol:22-46`). Approve reviewed router; start swaps disabled. Deploy our mined hook, pin
   adapter/USDC key/age policy, publish reviewed dated appraisal and initialize inside core band. Do not initialize using underlying/USDC address
   ordering.
6. Deploy engine inactive after pool initialization, bind hook to engine, configure underlying-property idle adapter and USDC slot, accept ownership
   handoffs. Issuer enrolls native custodians and approves engine wrapper/LP principal. Check mark, mapping, module hash and permission kernel before
   activation; no need to deploy PositionManager just to keep an unused NFT or duplicate hook approval map.
7. Activate, issue only qualified non-transferable shares, seed both sides and deploy within caps. Enable standard swaps; rehearse on testnet and
   record outputs/decoded refusals. Short-age fixtures can test grace without weakening the 48h keeper timelock. Demonstrate that band/staleness
   cannot block removal/collection; document native-freeze limitations and absence of standard forced-unwind recovery.
8. Curate new generation, switch shared readers and permissioned routing; retain USDC quote expectation. Migrate only assets voluntarily recovered
   from old claims. Keep old exits discoverable, archive facts, delete obsolete paths after reconciliation, and run full engine/adapter/hook/standard
   integration tests. Routing/API inclusion and issuer recovery are separate evidence; neither follows from successful swaps.

Remeasured nSLOC removes comments/blank lines, retaining imports/braces. **Removals are measured; additions are planning ranges, not implementation
results.** Vendor code is shown separately, not hidden.

| First-party Solidity scope | Added / growth | Removed | Net |
|---|---:|---:|---:|
| Retained hook: mark/time/pin + permission kernel | 105–145 | 0 | +105 to +145 |
| Owned wrapper: identity, share policy, exit reader, swap refusal | 40–60 | 0 | +40 to +60 |
| Core: mapping/constructor validation, exact dynamic fee, virtual exit reader; wrapper call-site updates | 40–60 | 0 | +40 to +60 |
| Shared lifecycle / measured settlement mapping | 35–55 | 0 | +35 to +55 |
| Checker bridge / replacement issuer fixture glue | 30–50 | 0 | +30 to +50 |
| Canonical setup additions / retire duplicate installer | 35–55 | 110 | −75 to −55 |
| Retire lending (68), dUSD (20), router (62), identity (23+4), property fixture (38), actor (34) | 0 | 249 | −249 |
| **Source/scripts/actor subtotal** | **285–425** | **359** | **−74 to +66** |
| Integration/regression replacement plus all added shared tests | 500–650 total | 494 | +6 to +156 |
| **Affected first-party Solidity estimate** | | | **−68 to +222** |

Measured file extents: `contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:1-482` (348 retained),
`contracts-v4/src/rwa/testnet/DemoLendingAdapter.sol:1-95`, `contracts-v4/src/rwa/testnet/DemoUSD.sol:1-34`,
`contracts-v4/src/rwa/testnet/DemoSwapRouter.sol:1-81`, `contracts-v4/src/rwa/testnet/MockRwaIdentityRegistry.sol:1-39`,
`contracts-v4/src/rwa/testnet/MockPermissionedPropertyToken.sol:1-61`, `contracts-v4/src/rwa/interfaces/IRwaIdentityRegistry.sol:1-13`,
`contracts-v4/test/rwa/MockRwaLiquidityVault.sol:1-42`, `contracts-v4/script/DeployRwaLiquidityUnit.s.sol:1-149`. Test baseline: 418 in
`contracts-v4/test/rwa/MintwareRwaLiquidityUnit.t.sol:1-527` plus 76 in `contracts-v4/test/audit-2026-10-31/RollingDrift.t.sol:1-84`. No deleting
coverage to force a negative number.

Upstream measured direct source: adapter 117 nSLOC, factory 36, abstract router 52, checker base 9
(`UP/src/hooks/permissionedPools/PermissionsAdapter.sol:1-164`; `UP/src/hooks/permissionedPools/PermissionsAdapterFactory.sol:1-48`;
`UP/src/hooks/permissionedPools/PermissionedV4Router.sol:1-69`; `UP/src/hooks/permissionedPools/BaseAllowListChecker.sol:1-13`). Interfaces,
libraries, base dependencies and the concrete router add more; this is **not** a complete dependency total. Standard PositionManager is 243 nSLOC
excluding inherited code (`UP/src/hooks/permissionedPools/PermissionedPositionManager.sol:1-338`), but is not deployed for this route. Keep upstream
code as pinned dependencies, not copied local savings.

The old negative-size guarantee is no longer defensible: standard settlement requires real integration. Net reduction remains the target, but this
conservative range crosses zero before dependency footprint. If a strict negative total remains mandatory, the integration spike must prove it before
rollout; do not call adapter allowlisting a complete implementation or conceal added tests/vendor code. Per asset: one engine, one hook, one
permissions adapter and two existing idle/yield adapters; reuse issuer checker and shared factory/router/module where possible. A new checker is
needed only without an existing compatible issuer source. No second oracle, NFT owner or wrapper-of-wrapper. Bytecode and TS cleanup are separate
measurements. The retained custom pieces are justified by our pooled claim and required band; issuer-native compliance, router settlement and later
credit follow established systems.

## Owner questions

1. Which issuer testnet token and existing checker will prove native custody, eligibility and recovery behavior?
2. Does the issuer accept the recommended non-transferable pooled shares and voluntary eligible-recipient exits, or require forced unwind that this
   direct engine does not provide?
3. Who controls appraisal/guardian roles, and what dated report cadence and risk limits should replace rehearsal values?
4. Is net-negative first-party Solidity a hard rollout gate even if the standard integration's measured delta is positive?
