# RWA unit: our hooked v4 pool + the shared MarketEngine

Design revision · 2026-10-31 · Base Sepolia only · fictional assets and valueless testnet capital.
This is an implementation recommendation; this ticket changes only this document.
Current-code citations use checkout `a7db72b458d3fe04313593abe6c1a6d794f16b2d`; historical citations name their commit.
Live deployments, deployed MW-03 status, runtime sizes and integration outcomes are **unverified** here.

## Product premise and recommendation

One MarketEngine instance per RWA asset supplies capital to **our own hooked v4 pool**. The engine owns
capital, adapters, LP positions, portfolio shares and in-kind exits; the appraisal hook owns this pool's
appraisal, trading band, band fee, staleness and exit window. Third-party pools retain the hookless
LP Gateway route. Every pool Mintware creates carries our hook. These are owner decisions.

Recommend a second thin engine wrapper, the existing appraisal hook extended to implement
`IMarketAssetMark`, and Base Sepolia USDC as quote. Reuse the shared core, lifecycle and adapters,
with only two narrow core edits described below. There is one portfolio share class: issuer inventory
receives the same shares as other contributions. No separate RWA vault, tranche, collateral or credit
product. One curated active generation per asset is a discovery policy; retired generations stay
addressable for exits, as resolution already supports (`lib/gateway/marketEngine.ts:62-94`).

Prior-work harvest, with proposals distinguished from implemented behavior:

| Source | Keep / reconcile |
|---|---|
| `bbdd22033:docs/developers/target-architecture.md:13-23` | Shared capital engine, lending seam, no tranche stack. The owner clarification supplies the own-pool hook boundary; an appraisal hook does not duplicate the capital engine. |
| `1a4e18956:docs/product/platform-architecture-adjudication-2026-10-28.md:220-254` | Script installation, explicit activation, independent valuation, transferable-share and in-kind-exit qualification. Independent means independent of pool spot; the hook can publish that mark. |
| `3c977d0d5:docs/developers/v2/DECISIONS.md:10-13,37` | Direct PoolManager positions, bound adapters and lean registry metadata. Do not import that branch's wider stack. |
| `.claude/rules/rwa-liquidity.md:15-25` | Retain hook, appraisal controls, grace window and token gate; replace the Treasury/tranche assumptions and the claim that LPs never receive property. The current installer already uses a test actor (`contracts-v4/script/DeployRwaLiquidityUnit.s.sol:18-26,97-116`). |

## 1. Engine variant, fee validation and curation

**Recommend `MintwareOwnedPoolMarketEngine`, a second thin wrapper.** It passes `allowHookedPool=true`
and pins the same verified lifecycle implementation. Keep `MintwareMarketEngine` as the third-party
wrapper: it currently passes `false` and pins the module codehash
(`contracts-v4/src/vaults/MintwareMarketEngine.sol:10-18`). A public constructor toggle on that wrapper
would blur its eligibility contract. Both wrappers must inherit the same accounting implementation.
For this first owned-pool variant, require a nonzero appraisal hook, `nonQuoteMark == poolKey.hooks`,
matching PoolManager/assets, and the exact dynamic-fee PoolKey. Future hook kinds need their own reviewed
eligibility policy; `true` alone is not an allowlist.

**Core edit 1: recognize the exact dynamic-fee sentinel.** Today any `fee > 1_000_000` fails even when
hooks are allowed (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:132-144`). Our hook requires
`isDynamicFee`, and its installer uses `LPFeeLibrary.DYNAMIC_FEE_FLAG`
(`contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:350-359`;
`contracts-v4/script/DeployRwaLiquidityUnit.s.sol:87-94`; recorded fee `8388608`: `config/rwaDemo.json:24`).
Proposed validity: `fee <= 1_000_000 || (allowHookedPool && hooks != 0 && fee == DYNAMIC_FEE_FLAG)`.
Keep the independent hook-address check. Do not mask off arbitrary bits or admit flag-plus-fee values.
The owned wrapper requires the sentinel; the old wrapper still rejects hooked/dynamic pools.
A static-fee workaround loses band-fee behavior; no derived constructor can bypass the base rejection.
The vendored v4 source directory is empty in this checkout, so its exact flag/callback implementation
is **unverified locally**; restore the pinned dependency and test sentinel, override-bit and boundary cases.

**Core edit 2: make `readPricesForExit` virtual, preserving its default body.** Its current self-only
implementation uses the ordinary fresh-price reader (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:668-672,783-787`).
Override only in the owned wrapper to read the same hook mark with the hook's age-plus-grace allowance,
using `MWMarketValuation.freshPriceWad`, retaining `msg.sender == address(this)` and token orientation.
That helper rejects zero/future/missing/stale observations (`contracts-v4/src/lib/MWMarketValuation.sol:23-35`).
Do not widen `maxMarkAge` globally: ordinary activation, contributions and deployment must expire at
trading freshness, while only partial-exit valuation receives grace. No new core storage or RWA branch,
no lifecycle edit, and no copied withdrawal function. Without this seam, full exits work stale but partial
exits cannot use grace; that is why a second small core edit is justified.

**Curation:** retain the existing registry and verifier. Verification already accepts an explicit
`allowedCodeHashes` list and checks owner, quote, activation, token order and pool identity, but has no
owned-pool classification or hook/mark-binding check (`lib/gateway/marketEngine.ts:23-59`). Add curator
metadata `third-party` / `owned` and select the corresponding approved wrapper/build hashes; verify
`hooks == 0` for the former and the approved hook, exact PoolKey, engine binding and mark identity for the
latter. Record actual deployed runtime hashes against reproducible builds, including immutable arguments;
a self-reported kind/version or a nonzero hook is insufficient. Hook ownership/keeper/config and exit
rehearsal also need curation evidence. This extends curation, not the chain quote rule or a second registry.

## 2. Binding, callbacks and exits

**Bind the hook's single actor to the engine, never to its module, owner or router.** `setVault` is
currently one-shot and derives the expected PoolId from that actor's `poolKey()`; add/remove callbacks
check the actor and pool (`contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:200-210,368-381`). Keep the
ABI name initially if helpful; update its terminology to “engine”. The lifecycle executes by delegatecall,
so PoolManager calls originate from the engine (`contracts-v4/src/vaults/MintwareMarketLifecycleModule.sol:18-21`;
`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:711-725`). An already-bound historical hook cannot
be rebound: install a new hook/pool/engine generation.

**Resolve the deployment cycle explicitly.** The core constructor requires an initialized pool
(`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:177-184`), but the current hook requires `setVault`
before initialization and reads deployed actor code (`contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:203-209,350-355`).
Recommend a one-shot, owner-only `pinPoolKey` in the hook before initialization, validating sorted
asset/quote, spacing, exact dynamic fee and this hook address. `beforeInitialize` then requires that pinned
key and the authorized owner as initializer, plus the existing fresh/core-band checks, without requiring
a deployed actor. After initialization, deploy the engine and let `setVault(engine)` verify the *same*
pinned key and PoolManager/mark bindings, without changing the pin. Until binding, refuse swaps and LP
operations; make `latestMark` unavailable so engine activation cannot precede binding. Constructor asset
getters remain available. This preserves anti-front-run pool binding without weakening the core's
initialized-pool invariant or adding a placeholder actor/factory. Test wrong-key, wrong-initializer,
early-activation and second-binding refusals.

| Engine operation | Pool calls and hook callbacks |
|---|---|
| Deploy liquidity | Collect if a position exists, then positive `modifyLiquidity` → `beforeAddLiquidity`. The overload may first swap idle assets → `beforeSwap` / `afterSwap` (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:368-440`; `contracts-v4/src/vaults/MintwareMarketLifecycleModule.sol:42-107`). |
| Recenter | Collect, negative modification → `beforeRemoveLiquidity`, then positive modification → `beforeAddLiquidity`; no swap in this path. Failed re-add rolls everything back (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:453-490`; `contracts-v4/src/vaults/MintwareMarketLifecycleModule.sol:110-165`). |
| Withdraw | Collect first, then negative modification for the requested LP fraction, adapter recalls and token payouts. It does not swap property into quote (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:534-619,643-650`). |
| Harvest / fee collection | Zero-delta `modifyLiquidity` (`contracts-v4/src/lib/MWV4PositionEngine.sol:84-100`). Expected v4 dispatch is the remove callback for delta ≤ 0; **unverified in the missing local dependency**, mandatory integration assertion. |
| Allocate / recall idle | Adapter calls only, no PoolManager liquidity action (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:307-329`). |

Keep LP callbacks limited to PoolManager, pinned pool and bound-engine authorization. **Never add band,
age, trading-pause or grace checks to removal or zero-delta collection.** Current LP callbacks already
omit those checks (`contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:368-381`). Keep the bound-engine swap
exemption: it currently skips pause/freshness/band checks and uses the core fee
(`contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:386-411`). It is not an arbitrary swap gateway: the
engine's optional deployment swap has a fresh mark, spot check, input bound, price limit and minimum
output, followed by deployment checks (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:335-440`).
Hook trading pause stops ordinary traders; it does not itself pause engine capital operations. Do not
reuse old claims about Treasury unwind bounds; this engine's withdrawals do not use that swap exemption.

**Can a hook revert trap exits? Yes.** Fee collection precedes the isolated LP-removal attempt, so a
collection hook revert aborts the whole withdrawal. A later removal revert marks LP delivery incomplete;
it does not magically deliver that LP's assets (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:541-567,597-605`).
Our pinned, non-rebindable hook must allow the engine's removal/collection regardless of band or age.
This removes policy-induced exit blocking, not token freezes, hook bugs or failed settlement.

Proposed age policy, measured from one source observation, with age/ grace fixed for the installation:

| State | Trading and new risk | In-kind withdrawal |
|---|---|---|
| Fresh: age ≤ max age | Normal hook band/fees and engine checks. | Complete delivery needs no valuation; incomplete delivery still needs mark/spot checks. |
| Exit window: max age < age ≤ max age + grace | Ordinary swaps halted; engine fresh-price operations refuse. | Complete delivery remains available; wrapper permits the old appraisal for partial valuation, subject to existing spot checks and delivery/minimum constraints. |
| Beyond grace / unavailable mark | Trading and new risk refuse. | Complete pro-rata delivery still works; incomplete delivery refuses until a valid mark and delivery path return. |

Today `oracleReady` includes grace, but the engine neither reads it nor distinguishes an exit-age allowance
(`contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:267-281`;
`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:534-540,668-672,783-787`). The table is proposed integration.
Grace is permission to value an incomplete exit, not a promise it succeeds: spot disagreement can still
refuse it (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:597-637`). Full exit remains available after
grace subject to readable accounting, permissions, settlement and output minimums. Engine pause does not
gate `withdraw` (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:521-525`).
Do not promise automatic LP recall on an appraisal alarm: `recallIdle` retrieves adapter capital,
while LP removal is tied to holder withdrawals; no owner-wide emergency LP recall is exposed
(`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:307-329,368-525,643-650`).

## 3. One appraisal source: the hook is the mark

**Implement `IMarketAssetMark` directly on the retained hook; no `IssuerAppraisalMark` contract.** Add
immutable asset, quote and decimal/orientation metadata, plus `asset()`, `quoteAsset()` and `latestMark()`.
The interface specifies whole quote per whole asset scaled by `1e18`, with the source observation time
(`contracts-v4/src/vaults/IMarketAssetMark.sol:4-19`). Derive the mark from the accepted appraisal tick,
never pool spot. In pool order, raw currency1/currency0 ratio is `1.0001^tick`; invert when property is
currency1, then multiply by `10^(propertyDecimals-quoteDecimals) × 1e18`. Use integer TickMath and
full-precision arithmetic, rejecting zero/overflow; test both token orders, decimals and rounding extremes.
A split adapter adds a contract without separating an independent authority and is unnecessary here.

Keep one appraisal history and all its controls in the hook:

| Control | Current evidence / recommendation |
|---|---|
| Step and publication interval | Retain hook enforcement, currently `maxStepTicks` and `minUpdateInterval` (`contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:237-243`). |
| Rolling 24h drift, MW-03 | Retain cumulative absolute-movement checkpoints and binary-search expiry, including reversals. Already present locally (`contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:244-260`); preserve every regression/model case (`contracts-v4/test/audit-2026-10-31/RollingDrift.t.sol:23-82`). Deployed fix status remains unverified. |
| Keeper rotation | Retain owner proposal/confirmation after 48h, without resetting history (`contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:61,296-309`). |
| Config changes | Retain 48h governance for mutable band/fee/movement settings. Currently config is instant before pool binding, delayed afterwards (`contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:314-331`). Freeze max age and grace when the key is pinned; enforce this in proposal **and** confirmation. Policy-age changes require a new generation. |
| Max age / grace | Hook owns the policy. At installation validate `engine.maxMarkAge == hook.maxAppraisalAge`; it is an immutable consumer threshold, not another appraisal store (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:190-203`). The exit override reads the hook's fixed age + grace. |
| Trading band and fee | Preserve core/spec fees selected from the pre-swap tick, post-swap spec-band rejection and the same-side gap-closing exception (`contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:386-433`). This is an enforced trading rule, not a realizable-value floor. |

Propose `initAppraisal/postAppraisal(tick, observedAt, reportHash)`: retain `appraisedAt` as publication
clock for rate limits and rolling movement; add one authoritative observation timestamp/report hash.
Currently the hook authenticates the transaction sender and stamps publication time only
(`contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:222-264`). Change `isFresh`, `oracleReady` and `latestMark`
to use the same observation time; never return current time to conceal age. Reject zero/future or
non-increasing observations and empty report hashes. A same-price refresh requires a genuinely new
assessment, not a cron heartbeat. `latestMark` returns the dated value even when stale after binding;
consumers enforce their distinct age windows. No second keeper, appraisal ledger or duplicated drift limit.

The signer attests a value; a transaction signature does not establish valuation quality. First appraisal
has no predecessor cap today (`contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:221-232`): review it before
initialization. If a genuine new assessment exceeds limits, pause new risk and review a new installation;
do not fabricate intermediate reports. Future collateral consumers must choose their own risk policy.

Rehearsal recommendation: retain core/spec bands 300/1000 ticks, step 500, interval 10 minutes, drift
1000/24h, max age 30 days, grace 7 days and fees 3000/10000 pips (current demo defaults:
`contracts-v4/script/DeployRwaLiquidityUnit.s.sol:48-58`). Propose a small USDC capital cap, 20% LP cap,
and a spacing-aligned appraisal-centered initial range about ±1000 ticks. Engine action tolerance is
separate: choose 1100 bps for rehearsal so it covers the configured spec band's approximate price width;
a tighter 300-bps tolerance would intentionally refuse partial exits in much of that band. Exact tick/
price boundary vectors must validate this choice; appraisal moves can still leave spot outside tolerance.
Recenter remains bounded, same-width and spot-centered near an edge, not automatically appraisal-centered
(`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:453-515`). Caps are action-time checks, not continuous
loss protection (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:399-440`). These are test parameters.

## 4. Quote, compliance, shares and idle assets

**Use existing Base Sepolia USDC, not dUSD.** The checked-in operating instructions identify
`MARKET_ENGINE_QUOTE_ASSET_84532` as `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
(`scripts/ops/relaunch-base-market.sh:18-23`). The verifier already checks one expected quote per chain
(`lib/gateway/marketEngine.ts:27-29,51-55`). Keep that rule and quote setting unchanged, enabling capital
reuse across markets. Live env/address/decimals and funding availability require deployment preflight;
they were not queried here. Label the asset testnet USDC. Express appraisals in that quote; a USD report
is not automatically a quote-token valuation under depegging. No fresh demo stablecoin or quote exception.

Token-level compliance remains necessary alongside the hook. The mock checks both nonzero transfer
endpoints against `permittedHolder OR registry.isVerified`
(`contracts-v4/src/rwa/testnet/MockPermissionedPropertyToken.sol:52-59`); expiry/revocation is registry-side
(`contracts-v4/src/rwa/testnet/MockRwaIdentityRegistry.sol:29-37`). Removing verification alone cannot
revoke a separately permitted address. Real issuer freeze/recovery/compliance behavior is **unverified**
until exercised against the chosen issuer testnet token; the mock is not certification.

| Address | Required property-token enrollment |
|---|---|
| Issuer inventory wallet, contributors and sellers | Permitted or verified; demonstrate revocation without a leftover permitted-holder bypass. |
| Engine instance | Enroll: receives contributions, moves assets through its adapter, settles with PoolManager and pays recipients. |
| Property-side idle adapter | Enroll: receives/returns property. |
| PoolManager | Enroll: custody and settlement. This is shared infrastructure, not a pool-specific identity. |
| Buyer / in-kind recipient | Verify or explicitly permit; quote-only LPs need an eligible property recipient for full delivery. |
| DemoSwapRouter | Enroll: property sells pass user → router → PoolManager; buys deliver PoolManager → buyer. |
| Other router / custodian | Enroll only actual transfer endpoints; check token-specific spender rules separately. |
| Quote adapter / quote ERC-4626 source | No property enrollment; apply quote-token restrictions independently. |
| Hook, lifecycle module, registry, owner/guardian/keeper acting only as callers | No property enrollment: these roles do not take property custody; the module acts as the engine. |

Transfer-edge evidence: `contracts-v4/src/vaults/MintwareMarketEngineCore.sol:267-283,663-665,711-735`;
`contracts-v4/src/vaults/MintwareIdleYieldAdapter.sol:120-145`;
`contracts-v4/src/vaults/MintwareMarketLifecycleModule.sol:18-21,43-87`;
`contracts-v4/src/rwa/testnet/DemoSwapRouter.sol:40-78`. The old installer enrolls PoolManager, actor and
router only (`contracts-v4/script/DeployRwaLiquidityUnit.s.sol:103-106`); property-adapter enrollment is new.

**Transferable shares remain an issuer decision.** Core shares are plain ERC-20; quote-only contribution
does not establish property-holder eligibility (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:36,267-303`).
Underlying token restrictions and the hook's LP gate do not restrict economic exposure through MWMS.
A revoked share owner can choose an eligible recipient: delivery is engine → recipient
(`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:528-530,663-665`). Require issuer acceptance of that
pooled-share model before activation. If share-holder restrictions are required, defer this asset; UI
allowlisting cannot supply on-chain share restrictions. Both issuer and LP hold the same claim.

Withdrawals deliver both assets in kind. Adapter/LP shortfalls use the least deliverable fraction;
recipient failures burn only marked value delivered, and retained shares remain a claim on the residual
portfolio, not segregated frozen tokens. Output-minimum failures roll back the transaction
(`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:573-639`). Demonstrate these failure cases:

| Failure | Current behavior and proposed recovery |
|---|---|
| Trader revoked | Property transfer fails; this alone does not revoke engine/other recipients. Restore issuer eligibility, never bypass the token (`contracts-v4/src/rwa/testnet/MockPermissionedPropertyToken.sol:52-59`). |
| Recipient revoked | That property leg can fail while quote is delivered and shares retained, but only with usable exit valuation, spot agreement, readable NAV and compatible minimums. Choose an approved recipient or restore eligibility (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:607-639`). |
| Property adapter revoked/frozen | Recall can return zero; the common fraction can reduce quote payout to zero too. Restore the adapter's transfer permission (`contracts-v4/src/vaults/MintwareIdleYieldAdapter.sol:139-145`; `contracts-v4/src/vaults/MintwareMarketEngineCore.sol:573-605`). |
| Engine / PoolManager frozen | Settlement or fee collection may revert the whole exit; no unconditional quote escape. Restore infrastructure eligibility, then retry (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:541-567`; `contracts-v4/src/vaults/MintwareMarketLifecycleModule.sol:42-87`). |
| Hook callback refuses | Collection can abort the entire exit; isolated removal failure becomes incomplete delivery. Binding/callback bugs must be excluded before activation; there is no bypass of a broken hook (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:541-567`). |
| Stale mark / partial delivery | Today ordinary max age applies. Proposed wrapper permits grace-only partial valuation; after grace, `ExitMarkUnavailable`. Restore appraisal and delivery; full in-kind delivery needs no mark (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:534-540,597-637`). |
| Spot outside action tolerance | Incomplete exit refuses even in grace; full delivery does not require spot agreement. Do not relax limits ad hoc to manufacture an exit (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:597-637,848-861`). |
| Source accounting unavailable | Adapter NAV reads can abort exit despite best-effort recall. Restore reads; do not fabricate NAV (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:762-773`). |

Do not revoke infrastructure until balances/LP obligations reconcile. Keep blocked generations visible.
Issuer forced-transfer recovery is unverified and must not be assumed to preserve PoolManager accounting.

**Idle/ERC-4626 slot:** property uses `MintwareIdleYieldAdapter`; quote uses the existing
`MintwareERC4626YieldAdapter` only with a reviewed testnet USDC source, otherwise explicitly choose zero
source and display “held ready”. The installer helper already selects these by source address and checks
`asset()` (`contracts-v4/script/lib/MarketEngineAdapterDeployment.sol:15-29`). For deterministic rehearsal,
reuse `MockERC4626` with faucet USDC and explicitly funded, simulated donations—no interest minting
(`contracts-v4/test/mocks/MockERC4626.sol:12-36`). Source availability is unverified; there is no new lender.
Adapters bind once (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:207-220`); source switching needs
a new generation. The ERC-4626 adapter uses `previewRedeem` NAV and best-effort recall
(`contracts-v4/src/vaults/MintwareERC4626YieldAdapter.sol:108-166`). Capacity overflow stays engine cash;
actual supply failure reverts (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:728-745`). Source loss,
fees and limited liquidity affect the one shared claim. Liquidity is this migration's entire scope.

## 5. Deletions and the /v1/rwas read contract

Archive historical proofs in Git history/an archive ref; remove obsolete code from active compilation
and imports only after reconciliation. Keeping renamed copies in compiled directories is not deletion.

| Artifact | Follow-up implementation disposition |
|---|---|
| `contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol` | **Retain and extend** for mark interface, source time and deployment binding. Preserve band, fees, MW-03, timelocks and exit window. |
| `contracts-v4/src/rwa/testnet/DemoLendingAdapter.sol` | Delete simulated minting path (`contracts-v4/src/rwa/testnet/DemoLendingAdapter.sol:56-85`); use the shared ERC-4626 slot. |
| `contracts-v4/src/rwa/testnet/DemoUSD.sol` | Delete once remaining test/script references are removed; its bespoke mint authority is unnecessary with USDC (`contracts-v4/src/rwa/testnet/DemoUSD.sol:19-32`). |
| `MockPermissionedPropertyToken.sol`, `MockRwaIdentityRegistry.sol`, `interfaces/IRwaIdentityRegistry.sol` under `contracts-v4/src/rwa/` | Retain testnet identity/token fixtures; no engine-specific compliance ledger. |
| `contracts-v4/src/rwa/testnet/DemoSwapRouter.sol` | Keep as test harness, accepts supplied PoolKey (`contracts-v4/src/rwa/testnet/DemoSwapRouter.sol:40-60`). Broader router support remains unverified. |
| `contracts-v4/test/rwa/MockRwaLiquidityVault.sol` | Delete after tests use the real engine; currently just a test LP actor (`contracts-v4/test/rwa/MockRwaLiquidityVault.sol:12-40`). |
| `contracts-v4/script/DeployRwaLiquidityUnit.s.sol` | Retire duplicate actor installer; harvest CREATE2 permission-bit mining and hook setup (`contracts-v4/script/DeployRwaLiquidityUnit.s.sol:76-110,133-147`) into canonical installation tooling. |
| RWA integration / RollingDrift tests | Retarget to engine composition, retain hook refusal and MW-03 coverage; do not delete valid tests to meet a size budget. |
| `config/rwaDemo*.json`, `lib/rwa/demo.ts` | Preserve old facts/hashes as history; replace active discovery and Treasury metadata (`lib/rwa/demo.ts:1-7,121-128`). |
| `/api/rwa/unit`, activity/appraisal scripts | Reuse shared engine reads; retain hook reads, band sizing and genuine appraisal publication. Retire Treasury/lending selectors (`app/api/rwa/unit/route.ts:27-49,132-141`), replace the same-tick freshness refresh with dated reports (`scripts/rwa-refresh-appraisal.mjs:65-75`). |
| `/v1/rwas` and detail/proof/how/issuer views | Keep routes/presentation; replace tranche/lock/simulated-rate fields currently emitted by the API (`app/api/rwa/unit/route.ts:209-215`) with one share and actual portfolio/source state. |

No Treasury contract deletion is counted: current deployment already uses the mock actor
(`contracts-v4/script/DeployRwaLiquidityUnit.s.sol:18-23`). Historical claims must not become engine shares
by relabeling them. No new appraisal contract, RWA capital module or separate state service.

**Read contract:** discover curated owned-pool rows by asset metadata; resolve explicit
`chainId + poolId + engineAddress`, including retired generations. Extend shared engine/hook ABIs as
needed; `/api/rwa/unit` may temporarily delegate to that reader. The current resolver handles inactive
generations (`lib/gateway/marketEngine.ts:70-94`); hook/source/issuer certification is an additional
curation obligation, absent from the current verification reads (`lib/gateway/marketEngine.ts:37-55`).

| Screen value | Source and meaning |
|---|---|
| NAV and user share | Engine `totalNav`, `totalSupply`, `balanceOf`: appraisal-valued portfolio, not realizable cash. Pending fees are excluded (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:238-243`). Keep share/exit controls visible if NAV fails. |
| Inventory / liquidity | Raw engine balances, adapter assets, position liquidity/range and pool spot; reuse position math (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:789-815`). |
| Appraisal / governance | Hook mark, observation/publication dates, report hash, keeper, pending changes; hook owns the source and limits (§3). |
| Pool rules | Hook core/spec bands, actual pre-swap fee policy, freshness, `tradingPaused`, `oracleReady` (`contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:267-291,386-433`). Show the gap-closing exception and engine exemption, not an absolute price floor. |
| Engine policy | Range, action tolerance, caps and separate fresh/grace/beyond-grace exit status. Internal age/deviation immutables need verified deployment metadata, not invented getters (`contracts-v4/src/vaults/MintwareMarketEngineCore.sol:79-83`). |
| Activity / proofs | Shared engine events, hook appraisal events and all pool Swap events. Remove router-only trade filtering (`app/api/rwa/unit/route.ts:163-184`). Keep old proof transactions labeled historical. |
| Availability | Engine activation/pause, hook status, relevant identity endpoints, source liquidity and transaction simulation. Failed reads are unavailable, never zero. |

Retain block-pinned reads and independent history fallback (`app/api/rwa/unit/route.ts:127-151,224-228`),
but label the actual pinned state block: today's response uses head despite reading head−1 (`app/api/rwa/unit/route.ts:129,199-200`).
Distinguish live/cached/recorded data and observation age; a historical snapshot must never look fresh.

## 6. Ordered testnet migration and size gate

These are acceptance steps for a later implementation PR; no deployment occurs in this documentation ticket.

1. **Inventory and freeze new old-demo activity.** Snapshot balances, claims, permissions, pool/key, bytecode
   and proof hashes; verify deployed MW-03 separately. Rehearse old exits without disabling recovery.
   Pass: reconciled ledger and reproducible old recovery. Live state is unverified until this runs.
2. **Implement the bounded changes.** Second wrapper, exact dynamic-fee core check, virtual exit reader,
   hook mark/time/pin changes and canonical installer mode. Today that installer hardcodes a zero hook,
   rejects the sentinel and creates the old wrapper (`contracts-v4/script/DeployMarketEngine.s.sol:102-141`).
   Keep its testnet/PoolManager gates and inactive finish (`contracts-v4/script/DeployMarketEngine.s.sol:58-74,156-175`). Restore pinned dependencies.
3. **Prove composition locally.** Test fee sentinel/illegal bits/old-wrapper refusal; initializer and binding
   attacks; mark conversion both orders; genuine observation timestamps; step/interval/drift, every MW-03
   case, keeper/config timelocks and frozen-age policy. Exercise core/spec fees, gap-closing exception,
   stale/paused swaps, optional engine swaps, deploy/recenter/zero-delta callbacks and atomic rollback.
   Test full exits fresh, in grace and beyond grace, with out-of-band spot and both pauses; partial exits
   at each age/spot boundary; every revoked endpoint, transferable shares/alternate recipient, source
   recall/view failure, nonzero frozen fees and output minimums. Decode exact errors. Pass: table outcomes.
4. **Prepare Base Sepolia hook and pool.** Verify canonical USDC, PoolManager, owner/keeper/guardian,
   funding and chosen source. Deploy token/identity fixtures if needed; CREATE2-mine the new hook's
   permission bits, pin the exact USDC/property key and freeze age policy, post a reviewed dated appraisal,
   initialize as authorized owner inside the fresh core band. Pass: no actor or public trading before binding.
5. **Install and bind the engine inactive.** Use chain 84532, `MARKET_TEST_ONLY=true`, the owned wrapper,
   hook as mark, verified lifecycle, property idle slot and selected USDC slot. Deploy after initialization,
   call `setVault(engine)`, configure dedicated adapters and complete ownership handoffs. Enroll engine,
   property adapter, PoolManager, router and test recipients. Pass: exact pin, codehashes, source asset,
   policy ages and every transfer edge verified; hook binding precedes activation.
6. **Activate, seed and rehearse on testnet.** Activate only after issuer share/exit acceptance. Issuer and
   test LPs contribute with nonzero minimum shares, seed both sides and deploy within caps. Record actual
   outputs and decoded refusal receipts for the local matrix; grace tests can use a separate short-age
   test fixture, while 48h governance stays intact. Pass: correct claims and no band/staleness LP trap.
7. **Curate and switch readers.** Register the owned generation with wrapper/hook evidence, unchanged
   chain quote expectation and shared reads. Pass: band/fee/exit states, unavailable NAV, permissions,
   actual state block, in-kind assets and historical proofs display correctly.
8. **Opt-in migration, then retirement.** Old holders recover assets under old terms; only received assets
   enter the new engine. No tranche-to-MWMS conversion ratio and no automatic dUSD-to-USDC parity claim:
   test users fund the new quote with testnet USDC. Preserve old claims/permissions until reconciliation,
   then archive obsolete configs and delete the listed executable paths. Pass: old recovery remains
   discoverable, new curation is correct, imports compile and measured net Solidity falls. Do not push.

Measured baseline nSLOC removes line/block comments and blank lines, retaining imports/braces; vendor
code is excluded. Remeasured in this checkout. Added counts below are **budgets, not implemented savings**.

| Solidity scope | Added / growth budget | Measured removal | Net budget |
|---|---:|---:|---:|
| Retain hook (348 nSLOC today), extend mark/time/binding | 70–100 | 0 | +70 to +100 |
| New thin owned-pool wrapper, including exit override | 30–45 | 0 | +30 to +45 |
| Two core edits | 3–6 | 0 | +3 to +6 |
| Delete DemoLendingAdapter + DemoUSD | 0 | 68 + 20 | −88 |
| Replace duplicate RWA installer with canonical setup additions | 35–50 | 110 | −75 to −60 |
| Delete mock liquidity actor | 0 | 34 | −34 |
| **Source + scripts + actor subtotal** | **138–201** | **232** | **−94 to −31** |
| Rewritten integration/regression suites, including added shared-engine cases | 450–500 total | 494 existing | −44 to +6 |
| **All affected Solidity target** | | | **−138 to −25** |

Measured file extents: `contracts-v4/src/rwa/MintwareRwaAppraisalHook.sol:1-482`,
`contracts-v4/src/rwa/testnet/DemoLendingAdapter.sol:1-95`, `contracts-v4/src/rwa/testnet/DemoUSD.sol:1-34`,
`contracts-v4/script/DeployRwaLiquidityUnit.s.sol:1-149`, `contracts-v4/test/rwa/MockRwaLiquidityVault.sol:1-42`.
The 494 test baseline is 418 in `contracts-v4/test/rwa/MintwareRwaLiquidityUnit.t.sol:1-527` plus 76 in
`contracts-v4/test/audit-2026-10-31/RollingDrift.t.sol:1-84`; measure replacement and new test growth together.
`src/**` delta, including retired demo sources, is **+15 to +63**; net reduction comes from removing
duplicate installer/actor machinery, not deleting the hook or counting already-retired Treasury. Keep this distinction visible.
Lifecycle, mark interface and adapter implementations stay unchanged. One new wrapper type; two demo
runtime types removed. Runtime bytecode size is a separate build check, not inferred from source lines.
Measure TS/TSX/script cleanup separately, target nonpositive, and count no historical JSON as Solidity savings.
If implementation exceeds budgets, report the actual delta and simplify duplicated setup/tests without
losing scenarios; a negative total is an acceptance target, not a reason to claim unmeasured savings.
Run existing engine/adapter/hook/MW-03 suites, composition tests and build-size checks in that PR.

## Owner questions

1. Does the issuer accept transferable pooled shares and eligible-recipient in-kind exits? If not, defer this asset.
2. Who owns appraisal publication, delayed rotation and guardian roles, and what report cadence replaces rehearsal settings?
3. Accept the proposed 30-day freshness / 7-day partial-exit grace and 1100-bps action tolerance for rehearsal, with complete exits remaining possible after grace?
4. Which issuer testnet token and restoration procedure will prove recovery from frozen infrastructure before activation?
