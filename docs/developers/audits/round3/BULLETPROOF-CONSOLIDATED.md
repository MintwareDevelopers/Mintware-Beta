# LP Gateway V1 — BULLETPROOF CONSOLIDATED

**Every open or accepted residual across every audit round, re-verified against the literal current code.**

**Date:** 2026-09-08 · **Verified against:** `main` @ `45e1f6d8` (post PR #477 / #478 / #479 / #481 / #482)
plus the un-merged branch `feat/lp-gateway-idle-yield-adapter` @ `4b87248e` (**PR #483**, read via `git diff`,
not checked out into the audited baseline) · **Live rig probed on-chain:** Robinhood Chain testnet `46630`.

**Method.** This document does **not** trust any prior report's status column. For every residual extracted from
rounds 1, 2, the close-out, round 3, and the pending PR, the cited file was opened at the cited line on the current
tree and the claim was confirmed or refuted. The live testnet instance was probed with read-only `cast call` and its
runtime code hash recomputed from chain. The `Discrepancy?` column is **blank when the report told the truth** and
**filled in loudly when it did not**.

**Scope of "re-verified".** Repo-resident facts (source, scripts, migrations *as files*, config) and on-chain facts
are verifiable here and were verified. Three classes are **not** verifiable from the repo and are marked
`UNVERIFIABLE-FROM-REPO`: Vercel environment-variable values, whether a migration has been *applied* to the
production Supabase, and Privy dashboard state.

---

## 0. The answer, up front

**Yes — the re-verification found discrepancies. Four of them. None is a security regression; all four are
documentation that has fallen behind code that is *safer* than the document claims, except the last, which is a
live copy/UX gap that the pending PR makes materially worse.** The single most important one is **D-1**: round 3's
own deep-dive report, `invariant-fuzzing.md` §0.1 and §0.4 — the exact section this review was told to treat as the
final state of the second pass — still declares **R3-INV-3 an open MEDIUM residual** with the words *"Fix direction
(not applied — `src/` out of scope)"*, when the fix **is applied on `main`**, is **in the bytecode of the live rig**,
and its regression test has already been renamed from `_RESIDUAL` to `_FIXED`. An external auditor handed the
deep-dive rather than the index would be told a live Medium exists that does not. Details in §4.

Everything else — 96 of the 100 tracked items — checked out exactly as its report claims.

---

## 1. Live-rig re-verification (round 3 rig 'g')

`config/deployments.json → testnet.robinhood-testnet` and `docs/developers/audits/round3/README.md` §5 both claim
rig 'g' is live. Probed read-only against `https://rpc.testnet.chain.robinhood.com` (chain id confirmed `46630`):

| Probe | Claimed | Read from chain | Match |
|---|---|---|---|
| `PositionManager` | `0xa52d4ffaefa586251cb36d1e05588daa89ab0a63` | responds, has code | ✅ |
| `keccak256(runtime code)` | `0x89a53e8da35d43715c50cd1354bbc376624ab6bfc56fccb96097db2baefc00f4` | `0x89a53e8d…00f4` | ✅ **exact** |
| `referencePrice()` *(round-3-only view)* | exists | `(79228162514264337593543950336, 11662075, 79228162514264337593543950336)` — i.e. sqrtPriceX96 = 2^96 (price 1.0), follower anchored, entry-high populated **non-zero** | ✅ |
| `ENTRY_MEMORY_BLOCKS()` *(round-3-only)* | `300` | `300` | ✅ |
| `OUTAGE_HAIRCUT_BPS()` *(round-3-only)* | `2000` | `2000` | ✅ |
| `MAX_DEPLOY_BPS()` | `5000` | `5000` | ✅ |
| `maxDeviationBps()` | `500` | `500` | ✅ |
| `owner()` / `harvestRecipient()` | gateway seat `0x18AE…663c` | `0x18AE027cF105393BF9Fe6a9F0d06A761D2a0663c` (both) | ✅ |
| `quoteAsset()` | tUSDG `0x2a8c…b848` | `0x2A8C32E291BC90CEB8aE058B6A684be0312bb848` | ✅ |
| `staging()` → `controller()` | staging `0x0a85…fa14`, controller = PM | `0x0A8544C0…FA14` → `0xa52D4ffA…0A63` | ✅ |
| adapter `vault()` | staging (production `MintwareERC4626YieldAdapter`, closes A-5) | `0x0A8544C0…FA14` | ✅ |
| `poolKey()` | tUSDG/tPONS, fee 3000, spacing 60, **hooks 0x0** | `(0x2A8C…b848, 0x4494…B9a7, 3000, 60, 0x0000…0000)` | ✅ |
| `paused()` / `deployedPrincipal()` | false / 0 | `false` / `0` | ✅ |

**`referencePrice().entryHigh` is non-zero on the live rig** — the direct on-chain observable of the R3-INV-3 fix
(see D-1). The code-hash match is the strongest single fact in this document: whatever `main`'s
`MintwareLpGatewayPositionManager.sol` compiles to is byte-for-byte what is deployed, so every source-level
re-verification below transitively applies to the live instance.

⚠ Round 3's README §5 records rig `'f'` `0xd87eaa9e…805cb` and `'e'` `0x259a9f1c…a6f442` as superseded. **None of
the round-3 sub-reports contain an on-chain probe of rig 'g'** — `equivalence-checks.md`'s "testnet rig
re-verification" table probes rig **'e'** (`0x259a…f442`, code hash `0xccb9e854…9f004`). That is chronology, not
error, but it means this document is the first on-chain confirmation of rig 'g'. See D-4.

---

## 2. PR #483 (idle yield adapter) — interaction analysis

The brief asked three specific questions about whether the un-merged idle-adapter PR silently reopens anything.
Answers, from the literal control flow, not the diff summary.

### (c) Does the PR touch the already-hardened gateway contracts? — **NO. Verified empty.**

```
git diff main feat/lp-gateway-idle-yield-adapter -- contracts-v4/src/gateway/   →  (empty)
```

The full PR is 7 files: one **new** contract `contracts-v4/src/vaults/MintwareIdleYieldAdapter.sol` (144 lines),
one **new** test `contracts-v4/test/MintwareIdleYieldAdapter.t.sol` (18 tests), two modified scripts, three
modified docs. `MintwareLpGatewayPositionManager.sol`, `MintwareLpGatewayStaging.sol` and
`MintwareLpGatewayFactory.sol` — the round-3-hardened, rig-'g'-deployed files — are **byte-identical to `main`**.
The rig-'g' code hash therefore remains valid under this PR. ✅

The new adapter is interface-compatible with the existing one (`IYieldAdapter`: `deposit`/`withdraw`/`totalAssets`/
`maxWithdrawable`/`maxSuppliable`) and reuses the same safety discipline verified elsewhere in this document:
`onlyVault` (`:61-64`), one-time `setVault` (`:86-91`), `Ownable2Step` with `renounceOwnership` reverting
(`:82-84`) — i.e. it ships C-9a already closed rather than reopening it.

### (a) Does `LP_GATEWAY_IDLE_MODE=true` short-circuit any other preflight check? — **NO. Verified by reading the whole function.**

`scripts/preflight-lp-gateway-mainnet.mjs#runPreflight` — the idle branch is a plain `if / else if / else` at
**lines 229-255** with **no `return`, no `throw`, no early exit**. Execution order and coverage under idle mode:

| Preflight section | Lines | Runs under `IDLE_MODE=true`? |
|---|---|---|
| §1 chain + canonical PoolManager/PositionManager wiring | 190-201 | ✅ (runs *before* §3; only early `return` is the pre-existing chain-id mismatch at `:201`, untouched by the PR) |
| §2 USDG: Paxos-address equality, code, `symbol()`, `decimals()==6`, EIP-1967 impl (M-07), `paused()==false`, **`isFrozen()` on signer + harvest recipient** | 203-226 | ✅ **all** |
| §3 yield source **or idle mode** | 228-255 | branch — idle path additionally *requires* `LP_GATEWAY_DEPOSIT_CAP` (`:235`) |
| §4 pool: key resolution, currency sort, **`sqrtPrice != 0` initialised**, **`hooks == 0x0` [A-6]**, USDG is a currency, **paired != 0x0 [A-8]**, **in-range L ≥ `LP_GATEWAY_MIN_POOL_LIQUIDITY`**, USDG-depth ≥ floor, tick order/alignment, tick inside range, **`LP_MAX_DEVIATION_BPS ∈ (0,5000]`** | 257-341 | ✅ **all** |
| §5 paired token **admin-control heuristics** (proxy / `owner()` / `paused()` / `isBlacklisted()` / `isFrozen()` / bytecode selector scan of token **and** implementation; FAIL unless `LP_GATEWAY_ALLOW_ADMIN_TOKEN`) | 343-380 | ✅ **all** |
| §6 signer is a funded EOA, harvest recipient is an address | 383-396 | ✅ |

Idle mode **adds** a fail-closed requirement (`LP_GATEWAY_DEPOSIT_CAP` must be set; `0` is valid, *unset* is not)
and removes only the four checks that are meaningless without an external source (`asset()==USDG`,
`totalAssets()>0`, `maxDeposit>0`, the C-10 `previewRedeem(convertToShares(1))` probe). **No previously-closed
finding is reopened.**

### (b) Does the deploy script's idle branch skip any post-wire assertion? — **NO. It adds two.**

`scripts/deploy-lp-gateway-mainnet.mjs`, post-wire block **lines 272-307**. Unconditional in **both** paths:
`adapter.vault()` `:273` · `adapter.asset()` `:274` · `adapter.owner()` `:275` · `staging.controller()` `:283` ·
`staging.deployer()` `:284` · `pm.quoteAsset()` `:285` · `pm.pairedAsset()` `:286` · `pm.staging()` `:287` ·
`pm.owner()` `:288` · `pm.harvestRecipient()` `:289` · **`pm.MAX_DEPLOY_BPS()==5000`** `:290` ·
**`pm.maxDeviationBps()==BAND`** `:291` · `pm.deployedPrincipal()==0` `:292` · `pm.tokenId()==0` `:293` ·
`pm.paused()==false` `:294` · `pm.tickLower/tickUpper` `:295-296` · `pm.quoteIsCurrency0()` `:297` ·
`pm.poolManager()` `:298` · `poolId(pm.poolKey())` `:299-300` · `pm.totalNav()==0` `:301` ·
`pm.poke()` simulates `:302-307`.

The **only** conditional assertions are the genuinely adapter-specific ones (`:276-282`): real path asserts
`yieldSource()` + `perBlockWithdrawCap()`; idle path asserts **`depositCap()` + `totalAssets()==0`**. Net: idle mode
runs *more* assertions, not fewer. Also unconditional and untouched: the **round-2 ABI-surface guard** (`:103-105`,
dies if the PM artifact lacks `poke`/`depositWithMin`/`withdrawWithMin`/`deployedPrincipal`/`MAX_DEPLOY_BPS`/
`setPaused`/`compoundQuote` — a stale pre-round-2 artifact cannot ship) and the **A-3 seat-separation guard**
(`:109-113`, requires `ORACLE_SIGNER_PROVIDER=privy` and dies if `GATEWAY_ORACLE_PRIVY_ADDRESS ==
ROOT_ORACLE_PRIVY_ADDRESS`). ✅

### The one real problem PR #483 introduces — see D-4

`grep -rn "IDLE_MODE|IdleYield|idleMode" lib app components` → **zero hits.** No app, API or UI code has any
awareness of idle mode, and `/api/gateway/meta` exposes no yield-source or adapter-kind field
(`app/api/gateway/meta/route.ts:95-118`). Meanwhile `components/web2/v1/V1PoolDetail.tsx:384` still renders
literally **`"Idle in Morpho" · "earns lending yield · zero IL" · "≥50%"`**. Under `LP_GATEWAY_IDLE_MODE=true` the
staged capital earns **exactly zero** and there is no Morpho. The PR's own doc admits *"the product's 'earns
immediately' claim does not hold while idle mode is on"* (`closeout/mainnet-yield-sources.md` §4) but ships **no UI
change**. This is a hard-copy-line violation on a money surface, not a cosmetic one. Full detail in §4, D-4.

---

## 3. Master table — every tracked finding / residual, latest status, re-verified today

Legend — **Status (verified)**: `FIXED` = fix present in current code at the cited line · `ACCEPTED` = knowingly
carried, still true in code · `OPEN` = not fixed, still true in code · `OPS` = action outside the repo ·
`UNVERIFIABLE-FROM-REPO`. `R1`=real-funds re-audit · `R2`=Hacken-style + red team · `CO`=close-out ·
`R3`=round 3 · `#483`=pending PR.

### 3.1 Contract layer — findings claimed FIXED, re-verified

| ID | Description | Sev | Found | Status (verified today) — file:line I opened | Discrepancy? |
|---|---|---|---|---|---|
| **A-1** | `withdraw` burned 100 % of shares without delivering 100 % of value | High | R1 | **FIXED** — per-leg best-effort + re-credit, `MintwareLpGatewayPositionManager.sol:527-585` (single offset on the whole claim, legs by un-offset weights) | |
| **A-2** | Zero-liquidity `_sweepFees` bricked the instance | High | R1 | **FIXED** — sweep guarded, `…PositionManager.sol:625` (`_sweepFees` before every principal change, H-02 ordering) | |
| **A-3** | Unbounded/unpriced `deploy` → owner-key principal extraction | High | R1 | **FIXED (both legs)** — on-chain `MAX_DEPLOY_BPS = 5000` at `…PositionManager.sol:56` on **cost basis** `deployedPrincipal` `:74`; cron refuses a 0 floor at `lib/gateway/deploy.ts:314`. **On-chain read: `MAX_DEPLOY_BPS() == 5000`** | |
| **A-3 key** | Shared `root` seat owned the gateway | High (ops) | R1 | **FIXED** — dedicated `gateway` role with **no shared-key fallback**, `lib/web3/oracleKeys.ts:37` (`gateway: ['GATEWAY_ORACLE_PRIVATE_KEY']`, comment: *"deliberately NO shared-key fallback"*); **on-chain `owner() == 0x18AE…663c ≠ root 0x7fD8…7E06`** | |
| **A-5** | Live rig ran a `MockYieldAdapter` anyone could drain | Medium | R1 | **FIXED + DEPLOYED** — rig 'g' adapter `0x4e1b…7b8a` is the production `MintwareERC4626YieldAdapter`; **on-chain `vault() == staging 0x0A85…FA14`** (`onlyVault`) | |
| **A-6 / A-8** | Hooked pools, native-ETH pairs, unordered/misaligned ticks accepted | Medium | R1 | **FIXED** — ctor rejects; **on-chain `poolKey().hooks == 0x0`**; preflight re-asserts at `scripts/preflight-lp-gateway-mainnet.mjs:294, 301, 335` | |
| **A-4 / O-4** | Buffer/fee ledger never written; DB-share-weighted harvest | High (3rd-party) | R1→CO | **FIXED** — event-indexed ledger exists: `lib/gateway/ledger.ts:138 indexHarvestLogs`, `:118 readSharesAtBlock`, `:377 listFeeBalances`; migration `supabase/migrations/20260908000002_gateway_fee_ledger.sql` present. *(R1 §8 says "⏳ open" — superseded by CO, correctly)* | |
| **A-7 / O-3** | Registry trusted a lookalike PM | Medium→High | R1→CO | **FIXED** — code-hash allowlist + factory path, `lib/gateway/registry.ts:271` (`if (!trust.pmCodeHashes.includes(codeHash)) return codehash_not_allowlisted`), seat checks `:231-239` | |
| **C-1** | Withdraw under-paid whenever spot > follower | High | R2 | **FIXED** — pure pro-rata exit; `…PositionManager.sol:527-585`, `withdrawWithMin` at `:471` | |
| **C-2** | A paired-token failure froze all funds incl. idle quote | High | R2 | **FIXED** — best-effort LP leg + re-credit, `…PositionManager.sol:551-585` | |
| **C-3 / RT-9a** | Deploy cap capped *marked* value → martingale | Med-High | R2 | **FIXED** — cost-basis cap, `…PositionManager.sol:73-74` (*"Never moves with price — the base of the MAX_DEPLOY cap"*), decrement `:576-577` | |
| **C-4 / RT-2** | Re-credit re-read `_spot()` after external calls | Medium | R2 | **FIXED** — spot cached once, weight-only, `…PositionManager.sol:527-535` | |
| **C-6** | No slippage bounds | Medium | R2 | **FIXED** — `depositWithMin` `:427`, `withdrawWithMin` `:471`; UI wires them via `meta.supportsMin` (`app/api/gateway/meta/route.ts:116`) | |
| **C-7** | Follower only advanced on gateway actions | Low | R2 | **FIXED** — permissionless bounded `poke()` at `…PositionManager.sol:632` | |
| **C-9a** | Adapter one-step `Ownable` | Low | R2→CO | **FIXED** — `Ownable2Step` + renounce disabled (also shipped this way in the **new** `MintwareIdleYieldAdapter.sol:38, 82-84`) | |
| **C-9b / F-07** | Factory did not verify adapter binding | Low | R2→CO | **FIXED** — `MintwareLpGatewayFactory.sol:51-53` (`AdapterAssetMismatch`, `AdapterUnreadable`, `AdapterAlreadyBound`), `Ownable2Step` at `:21` | |
| **C-10 / RT-5f** | Reverting `previewRedeem` bricked NAV reads | Low | R2→CO | **FIXED** — tolerant read, `…PositionManager.sol:115 lastKnownIdle`, `:161 SourceUnavailable`, `:308-309` | |
| **F-02 rec.3** | Immutable `harvestRecipient` unrecoverable on freeze | (from F-02) | R2→CO | **FIXED** — 48 h timelocked rotation, `…PositionManager.sol:108-110, 279-300` (`harvestRecipientEta`, `RotationNotReady`) | |
| **F1** | Per-leg VIRTUAL offset re-credited phantom shares | High | R3 | **FIXED** — single offset on the whole claim, `…PositionManager.sol:527-535` (comment cites *"Round-3 fuzz F1"*) | |
| **F1-b** | `SourceUnavailable` refusal was dead code | High | R3 | **FIXED** — by the F1 fix, same lines | |
| **F2 / XR-3** | Unchecked depositor into an empty 4626 | Med-Low | R3 | **FIXED** — `STAGE_TOLERANCE_BPS = 50` `:138`, `StageShortfall` `:165`, check `:454` | |
| **XR-1 / E-1** | Held dump + follower walk cheapened the entry mark | High | R3 | **FIXED (bounded)** — entry-mark memory, `ENTRY_MEMORY_BLOCKS = 300` `:126`, `_recordEntryHigh` `:385-394`, `_entryHigh` `:397-400`. **On-chain `ENTRY_MEMORY_BLOCKS() == 300`** | |
| **XR-2 / X-7** | Uninitialised pool; first deploy had no band | Medium | R3 | **FIXED** — ctor check + follower anchored at creation; **on-chain `referencePrice()` returns a non-zero anchored follower** | |
| **E-3 / inv-15** | Compromised seat: one-sided deploy at the range edge | High (owner key) | R3 | **FIXED** — `MIN_TWO_SIDED_BPS = 5000` `:142`, `DeployNotTwoSided` `:166`, enforced on **used** amounts `:722` | |
| **E-2** | Exit re-credit weighted at spot | Medium | R3 | **FIXED** — exit weight = holder mark, `…PositionManager.sol:527-585` | |
| **E-4** | Liquidity slice could exceed the position | Low | R3 | **FIXED** — by F1 (`liqToRemove = min(...)`) | |
| **R3-1** | `lastKnownIdle` stale-high during a source-outage loss | Medium | R3 | **FIXED** — `OUTAGE_HAIRCUT_BPS = 2000` `:135`, applied `:514-515`. **On-chain `OUTAGE_HAIRCUT_BPS() == 2000`** | |
| **R3-2** | Capped source DoS'd every deploy | Low | R3 | **FIXED** — `try staging.stage(quoteLeft) {} catch { … }` at `…PositionManager.sol:732-733` | |
| **X-3** | Staging trusted the adapter's returned amount | Low | R3 | **FIXED** — balance-diff, `MintwareLpGatewayStaging.sol:71-73` (comment cites *"Round-3 X-3"*) | |
| **R3-INV-1** | Exit weight over-credited an exiter whose LP leg failed | Medium | R3 | **FIXED** — per-leg re-credit weights, `…PositionManager.sol:551-585` | |
| **R3-INV-2** | Deferred-re-stage parked quote sat outside NAV | Low | R3 | **FIXED** — `_idle()` counts the PM's own quote, `…PositionManager.sol:310`; deploy consumes parked first `:662`; withdraw pays it first `:551` | |
| **R3-INV-3** | Unset entry bucket read as sqrtPrice 0 → LP marked at range-edge max | Medium | R3 | **FIXED** — `_marksHigher` at **`…PositionManager.sol:377-381`**, line **`378: if (a == 0) return false;`**, with a comment naming R3-INV-3 at `:375-376`. Regression already renamed `…_FIXED` (`contracts-v4/test/audit3/InvariantForkRegressions.t.sol:553`). **On-chain `referencePrice().entryHigh != 0`** | 🚨 **YES — see D-1** |

### 3.2 Contract layer — findings currently OPEN or ACCEPTED

| ID | Description | Sev | Found | Status (verified today) — file:line I opened | Discrepancy? |
|---|---|---|---|---|---|
| **XR-4** | `compoundQuote` books profit atomically; a 2-block hold captures ~90 % | Low (owner sole depositor) → Medium with third parties | R3 | **OPEN — confirmed.** `…PositionManager.sol` `compoundQuote` body is `safeTransferFrom → forceApprove → staging.stage → _syncIdle → emit`. **No linear unlock, no vesting, no cliff.** | |
| **X-1** | Read-only reentrancy: `totalNav`/`sharesOf`/`totalShares` readable mid-`redeem` | Info → hard rule | R3 | **OPEN — confirmed.** `totalNav()` at `…PositionManager.sol:800` is a bare `public view`; **no `nonReentrantView` exists anywhere in the file**. `totalShares`/`sharesOf` are auto-getters and cannot be guarded. Documented as an integration prohibition. | |
| **Q5** | Owner paired-leg subsidy captured 100 % by holders at deploy time | Design (3rd-party) | R3 | **OPEN — confirmed** (no owner-share mechanism in the contract) | |
| **X-2** | Source that swaps `asset()` after construction: withdraws pay, **deposits still revert**, swapped-in token stranded in staging with no sweep | Med-Low | R3 | **ACCEPTED (partial fix)** — `MintwareLpGatewayStaging.sol` has **no rescue/sweep function** (file ends at `:85`); adapter `asset` is `immutable` | |
| **X-4** | Preview-fine / redeem-realises-loss source → first-mover advantage ~9 % | Low | R3 | **ACCEPTED** — non-compliant-source class, curation-gated | |
| **X-5 / L-05** | Entry-fee source dilution inside the 50 bps `StageShortfall` tolerance | Low | R3 | **ACCEPTED** — bound is `STAGE_TOLERANCE_BPS = 50` at `…PositionManager.sol:138`; >0.5 % now reverts | |
| **X-6** | Issuer freeze of a depositor strands their unfrozen paired leg too | Low (design/legal) | R3 | **ACCEPTED** — no `to` parameter on the idle-leg transfer | |
| **X-8 / X-9 / X-10** | Factory `deactivate` is a registry flag only; residual Permit2 allowance (inert); re-credit composition drifts toward the LP | Info | R3 | **ACCEPTED / by design** | |
| **F3 / F3-b** | Adapter over-delivers ≤ 1 source share; cost basis 1–2 wei over the cap | Info | R3 | **ACCEPTED (wei-level)** | |
| **XR-1 residual** | A dump **held ≥ 600 blocks (~2 h)** with one `poke()` per period rewrites both memory buckets and reproduces the original XR-1 numbers | High-class, quantified | R3 | **ACCEPTED — structurally true.** Two buckets × `ENTRY_MEMORY_BLOCKS = 300` (`:126`) ⇒ the memory horizon is exactly 600 blocks by construction. Carried by the share cap + arbitrage-presence policy | |
| **XR-2 residual** | Pool already mispriced *before* creation, or an empty pool walked with free `poke()`s, passes band + two-sided at 2× | Medium-class | R3 | **ACCEPTED — off-chain guard only.** The guard is the cron's external reference (`lib/gateway/deploy.ts:124-131, 300-310`, `ref_price_deviation` / `ref_price_unavailable`), which is **not** enforced on-chain and is **explicitly waived on the testnet rig** (`LP_GATEWAY_DEPLOY_REQUIRE_REF_PRICE=false`, round-3 README §5) | |
| **inv-15 dust note** | `DeployNotTwoSided`'s integer check is vacuous at dust scale | Info | R3 | **ACCEPTED** — `pairedUsedVal < (quoteUsed * 5000)/10_000` at `:722` is integer, so 0 < 0 is false | |
| **ctor half-memory** | Constructor writes only ONE entry bucket, so the "current + previous period" memory is half-populated for the first period on every gateway | "not a finding" | R3 | **CONFIRMED true** — `_recordEntryHigh` `:385-394` writes A **or** B by parity. Harmless post-R3-INV-3 (an unset bucket is now ignored rather than read as 0) | |
| **C-9a residual** | `perBlockWithdrawCap` is an instant, unbounded owner lever (exit throttle) | Low | CO | **ACCEPTED — still true.** No timelock/floor on the setter. Directly contradicts a live UI string — see D-4 | |
| **C-10 residual** | `lastKnownIdle` is the last *successful* read; yield after it is invisible during an outage | Low | CO | **ACCEPTED** — conservative direction, `…PositionManager.sol:115` | |
| **Rotation residual** | `acceptHarvestRecipient` is owner-only; a frozen recipient still blocks harvest/deploy for up to 48 h | Low | CO | **ACCEPTED ("that IS the safety margin")** — `HARVEST_RECIPIENT_DELAY` + `:287` `RotationNotReady` | |
| **EIP-170 margin** | Factory runtime 23,631 B — only 945 B under the 24,576 B cap | Ops/Info | CO | **ACCEPTED — still exactly true, verified without recompiling.** `git diff 74f9b9b1 main -- contracts-v4/src/gateway/MintwareLpGatewayFactory.sol` is **empty**, i.e. the source is byte-identical to the commit the 23,631 B figure was measured at, and PR #483 does not touch it either | |
| **R-onchain-1** | Issuer-controlled paired tokens can freeze **and** drain — no code change removes it | High (economic) | R2 | **ACCEPTED** — mitigation is curation; the preflight's admin-control heuristic (`preflight…mjs:343-380`) is a *heuristic* that FAILs closed unless overridden | |
| **R-onchain-2** | Follower speed is per **block**, not per time (RH `block.number` = L1, ~12 s) | — | R2 | **ACCEPTED** | |
| **R-onchain-3 / A-9** | Owner paired contributions are a depositor subsidy | — | R2 | **ACCEPTED** (= Q5) | |
| **R-onchain-4** | PM owner and adapter owner are the same Privy seat (ransom-shaped, not a sweep) | — | R2 | **ACCEPTED** — still true; `GATEWAY_ORACLE_PRIVY_ADDRESS` owns both | |
| **R-onchain-5 / M-07** | USDG issuer can freeze **and wipe**; a wipe of PM/staging is permanent loss | Medium | R1/R2 | **ACCEPTED (bounded exposure + disclosure).** Preflight pins the Paxos address at `preflight…mjs:54` and probes `paused()` + `isFrozen()` at `:217-225` | |
| **R-onchain-6** | Bounded-rollout gate (own funds, deep pools, tiny first amount) | — | R2 | **ACCEPTED GATE — still in force** | |
| **Q1 / Q3 / R8** | Single-venue pools with no arbitrage keep ratio ≈ s/φ; R8's 2 % share is 3–6× above break-even | Policy | R3 | **OPEN (policy)** — recommendation to cap third-party share ≤ 0.5 % is **not** encoded anywhere in code | |
| **Q2** | `deployRatioBps` owner-lowerable + timelocked increases | Design | R3 | **OPEN — not implemented.** `MAX_DEPLOY_BPS` is a `constant` at `:56`; the ratio lever is env-only (`LP_GATEWAY_DEPLOY_RATIO_BPS`) | |
| **Q6** | Second signer on `acceptHarvestRecipient` / `deploy` size | Design | R3 | **OPEN** — both are single-`onlyOwner` | |
| **Q4 floors (UI)** | E-2 not covered by `withdrawWithMin`'s 1 % floors | UI | R3 | **OPEN** | |
| **C-6 residual (a)** | Deposit quote uses `totalNav` while the contract mints off the holder mark ⇒ a ref/spot gap > 1 % reverts; withdraw floors include the LP leg, so a best-effort LP failure now **reverts instead of re-crediting** | — | CO | **ACCEPTED — structural.** `withdrawWithMin(shares, minQuoteOut, minPairedOut)` at `:471` forwards both floors into `_withdraw`, so the A-1 re-credit path is bypassed when a floor binds | |

### 3.3 Off-chain / infra — claimed FIXED, re-verified

| ID | Description | Sev | Found | Status (verified today) — file:line I opened | Discrepancy? |
|---|---|---|---|---|---|
| **O-1 / HO-1 / R-3** | UI deposit POST unsigned → 401 behind "Deposited ✓"; withdraw never recorded | High | R2 | **FIXED** — route requires signed message (`app/api/gateway/deposit/route.ts:126`, `auth:'signed-message', action:'mintware-gateway-deposit'`) **and the client actually signs** (`components/web2/v1/V1PoolDetail.tsx:190-195`, `buildGatewayDepositMessage` → `wallet.signMessage` → body carries `authMessage`/`authSignature`) | |
| **O-2 / HO-2 / R-1** | Slug → env-PM fallback reported `live:true` | High | R2 | **FIXED** — `lib/gateway/routeInstance.ts:56-58` registry ⇒ `live:true`; `:73-74` env ⇒ `source:'env-fallback', live:false`; registry hit required once populated (`:82`) | |
| **O-5 / HO-3** | CSP `connect-src` blocked the RH RPC | Medium | R2 | **FIXED** — `next.config.mjs:20` includes both `rpc.testnet.chain.robinhood.com` and `rpc.mainnet.chain.robinhood.com`; CSP is **enforced** (`:90`) | |
| **O-7 / R-4** | Feed poisoning (score steerable, APR unbounded, USDG by name, no timeout) | Medium | R2 | **FIXED** — `lib/gateway/discovery.ts`: USDG **by address only, fail-closed** `:320-323`; `safeImg` `:70`; `parseFeePct` `:87`; 8 s `AbortController` + bounded retries `:44, :264-314`; prune grace `:344`. `lib/gateway/riskScore.ts:32` — verdict type is literally `'ineligible' \| 'review'`, **never "safe"** | |
| **O-8 / R-5 / HO-9** | `/sparklines` fan-out; rate limits no-ops | Medium | R2 | **FIXED for the two hot routes** — `app/api/gateway/sparklines/route.ts:30` in-memory 429 floor, `:38` id validation + `truncated`, `:44` declared `rateLimit`; `app/api/gateway/discover/route.ts:78` same | |
| **O-9 / HO-8** | One global absolute-`L` `minLiquidity` for all pools | Medium (latent) | R2 | **FIXED** — `lib/gateway/deploy.ts:69-81 computeDeployMinLiquidity` computes per pool from spot; env demoted to an **additional** floor (`:80`); computed 0 ⇒ refuse (`:314`) | 🚨 **YES — see D-2** (a rule file still says otherwise) |
| **O-10 / R-6 / F-2** | Signed `txHash`/`pool` not bound to body; 15-min replay; sig-malleability twins | Low | R2/R3 | **FIXED** — `lib/gateway/recordAuth.ts:25 bindSignedRecord`, result type `:14` carries `auth_payload_mismatch` / `auth_replayed`; replay keyed on the **message**, not the signature | |
| **O-11 / R-7** | Leaderboard ranked on Σ`entry_nav` | Low | R2 | **FIXED** — `lib/gateway/chainTruth.ts:1-13` (*"DB rows are only the address source; every money number … on-chain … pinned to one block"*), consumed by `lib/gateway/leaderboard.ts:6` | |
| **O-12** | `NODE_ENV=development` bypassed bearer auth | Low | R2 | **FIXED** — `lib/web2/routeHandler.ts:266-272`: fails closed with `500 MISSING_SECRET` unless **both** `NODE_ENV==='development'` **and** `ALLOW_DEV_BEARER_BYPASS`, and warns on every request | |
| **C-01** | Curate bearer fell open on an unset secret | Critical (auth) | R2 | **FIXED** — `app/api/gateway/curate/route.ts:222` passes `process.env.LP_GATEWAY_CURATOR_SECRET ?? ''`; `:212` returns `503 curator_secret_unset` on empty. Primary path is now a **signed-message curator allowlist** (`:176 LP_GATEWAY_CURATORS`, `:198-202` payload binding) | |
| **O-13** | `next` advisories | Low | R2 | **FIXED** — `package.json` `next: 16.2.12` | |
| **HO-11** | Discover `live` ignored instance status | Low | R2 | **FIXED** — `app/api/gateway/discover/route.ts:51` `.eq('status', 'active')` | |
| **F-1 / F-7** | Ledger views owner-executed (anon-readable); `record_gateway_harvest` anon-callable | Medium/Low | R3 | **FIXED (file present)** — `supabase/migrations/20260908000003_gateway_ledger_view_security.sql` exists. Prod application `UNVERIFIABLE-FROM-REPO` (close-out README item 1 asserts it was applied) | |
| **F-3** | `markRestaked` swallowed write errors → double compound | Low/Med | R3 | **FIXED** — two-phase settlement in `lib/gateway/ledger.ts:262 listPendingRestake / :310 claimRestake / :315 releaseRestake / :320 markRestaked / :331 listStuckRestaking` | |
| **F-5** | Code-hash trust root pinned immutables, not `owner()`/recipient/adapter binding | Medium (latent) | R3 | **FIXED** — `lib/gateway/registry.ts:231-239`: `owner_mismatch`, `recipient_not_allowlisted`, `adapter_unbound`, `adapter_vault_mismatch`; seat config `:104-116` | |
| **F-6** | `ORACLE_SIGNER_PROVIDER` typo silently selected env-key mode | Low | R3 | **FIXED** — `lib/web3/oracleSigner.ts:53` throws on any value but `privy`/`env-key` | |
| **F-10** | CSP `connect-src https://*.supabase.co` allowed exfiltration to any project | Low | R3 | **FIXED** — `next.config.mjs:16-20` pins hosts | |
| **§6 PFP** | Avatar upload had no content validation | Product | CO | **FIXED** — `lib/profile/avatarUpload.ts:19-33` magic-byte sniff, never trusts declared content-type | |
| **Build break** | `app/api/gateway/leaderboard/route.ts` exported `__resetLeaderboardCache` (invalid Next route export) | — | CO | **FIXED** — the export is **gone**; cache moved to `lib/gateway/leaderboardCache.ts` (`route.ts:40-42`, comment: *"route modules may only export handlers"*) | 🚨 **YES — see D-3** (close-out record still says "OPEN — lead action") |

### 3.4 Off-chain / infra — currently OPEN or ACCEPTED

| ID | Description | Sev | Found | Status (verified today) — file:line I opened | Discrepancy? |
|---|---|---|---|---|---|
| **HO-13** | `/api/gateway/meta` publishes the server RPC URL | Low | R2 | **ACCEPTED — still true.** `app/api/gateway/meta/route.ts:103` `rpcUrl: cfg.rpcUrl`. Never put a keyed provider URL in `LP_GATEWAY_RPC_URL` | |
| **HO-14** | Testnet deploy script silently falls back to the shared `ROOT_*` seat | Low | R2 | **OPEN — still true.** `scripts/deploy-lp-gateway-robinhood.mjs:95-96` (`GATEWAY_ORACLE_PRIVY_WALLET_ID ?? ROOT_ORACLE_PRIVY_WALLET_ID`), `:114` same for the auth key. *(The **mainnet** script has no such fallback and actively refuses seat collision — `deploy-lp-gateway-mainnet.mjs:110-113`.)* | |
| **HO-15** | Public GETs declare no `rateLimit` | Low | R2 | **OPEN — still true.** Zero `rateLimit` occurrences in `app/api/gateway/{instances,position,positions,leaderboard,meta,alerts}/route.ts` | |
| **O-8 residual** | `/api/gateway/request` has a declared limit but **no in-memory floor** (no-op without Upstash) | Low | CO | **OPEN — still true.** `app/api/gateway/request/route.ts:47` declares `rateLimit`, imports no token bucket | |
| **Rate limiting inactive** | Upstash unset in prod ⇒ every declared `rateLimit` is a no-op (fail-open) | Medium (ops) | R2 | **OPS / UNVERIFIABLE-FROM-REPO.** Code path exists and logs once at boot (`lib/web2/routeHandler.ts`); close-out item 2 asserts Upstash was already set | |
| **Env-fallback for `/alerts`** | `resolveRouteInstance` (legacy, env-falling-back) still used by one route | Low | CO | **ACCEPTED — still true.** `app/api/gateway/alerts/route.ts:3, :13` imports and calls `resolveRouteInstance` from `lib/gateway/registry.ts:280`. Read-only route; must never be re-wired into a money path | |
| **HO-12 / replay set** | Replay set is per-process (serverless); no shared nonce store / EIP-712 | Low | R2/CO | **OPEN — still true.** `lib/gateway/recordAuth.ts:55 _resetReplayGuard` implies an in-module set | |
| **R-8 residual / keys** | `range` / `agent` oracle roles still fall back to the shared, git-exposed `ORACLE_PRIVATE_KEY` | Low (gateway unaffected) | R2 | **OPEN — still true.** `lib/web3/oracleKeys.ts:35-36`: `range: [...,'ORACLE_PRIVATE_KEY']`, `agent: [...,'ORACLE_PRIVATE_KEY']`. `gateway` correctly has none (`:37`) | |
| **Swap-seam slippage** | Executor slippage accepts up to **5000 bps** | Low | R2 | **OPEN — still true.** `lib/gateway/v4SwapExec.ts:68-69`: default `100`, accepted range `1…5000`. "Tighten before wiring" not done | |
| **O-4 residual 1** | Paired-leg proceeds un-attributed under `HARVEST_DESTINATION=buffer` | — | CO | **ACCEPTED.** `lib/gateway/opsConfig.ts:11` default is **`buffer`**, and `restake` is the recommended setting — so the unsafe-for-third-parties mode is still the *default* | |
| **O-4 residual 2** | Fee credits are an off-chain IOU; `gateway_fee_payouts` has **no writer** | — | CO | **OPEN — still true.** `gateway_fee_payouts` appears only in the migration and in read-side views; no `lib/` code inserts into it | |
| **O-4 residual 3** | `record_gateway_harvest` trusts caller `shares_at_block`; `LP_GATEWAY_INDEX_CONFIRMATIONS` defaults to 1 (reorg window) | — | CO | **ACCEPTED** — raise confirmations before third-party funds | |
| **O-3 residuals 1-4** | `LP_GATEWAY_FACTORY` is an operator-set trust anchor; code-hash pins bytecode not ctor args; `getCode` read at latest; bearer path records `server:bearer` | — | CO | **ACCEPTED — all still true** (`lib/gateway/registry.ts:91, 124, 145, 262-272`) | |
| **O-7 residual 1** | Discovery numbers are **upstream-asserted**; a wash-traded fake can score 0 | — | CO | **ACCEPTED (honest).** Enforced by `lib/gateway/riskScore.ts:32` capping the verdict at `'review'`; the UI chip must not read as certification | |
| **HO-17** | UI copy: "Idle in Morpho", "always in range", "withdraw anytime", `Trust ·` chip | Info | R2 | **OPEN — all three still present verbatim.** `components/web2/v1/V1PoolDetail.tsx:384` (`"Idle in Morpho" / "earns lending yield · zero IL" / "≥50%"`), `:390` (`"always in range, no rebalancing"`), `:545` (`"No — withdraw anytime"`) | 🚨 **YES — see D-4** |
| **O-1 residual (b)** | Embedded (Privy) wallets refused for transactions | — | CO | **ACCEPTED — still true.** `V1PoolDetail.tsx:165` throws *"Connect an external EVM wallet … (embedded-wallet transactions are coming)"* | |
| **F-4** | Per-IP floor trusts `X-Forwarded-For` | Low | R3 | **ACCEPTED (platform-mitigated)** | |
| **F-8** | `gateway_alerts` missing in prod | Low | R3 | **OPS — file present, application `UNVERIFIABLE-FROM-REPO`.** `supabase/migrations/20260907000003_gateway_alerts.sql` exists; round-3 README §5 item 2 still lists applying it | |
| **F-9 / F-11 / F-12 / F-13** | PNG polyglot; transitive advisories; leaderboard RPC fan-out; reorg at 1 confirmation | Info/Low | R3 | **ACCEPTED / documented** | |
| **Off-chain §5 res. 1-3** | No replay set on curate / position-POST / avatar; `PM_CODEHASHES` is per-instance not per-build; `harvest_events.collect_tx` idempotency checked after the tx | — | R3 | **OPEN — all three still true** | |
| **D-1…D-13, HO-18** | Round-2 documentation-vs-code drift registers (24 items) | Info | R2 | **CLAIMED FIXED by O-14; PARTIALLY TRUE.** See D-2 | 🚨 **YES — see D-2** |

### 3.5 Ops / gates — outside the repo

| ID | Item | Found | Status (verified today) | Discrepancy? |
|---|---|---|---|---|
| **Mainnet yield source** | All **39** USDG Vault V2 instances on RH mainnet report `maxDeposit == 0` — no source with capacity exists | CO | **OPEN — the standing blocker.** PR #483's idle adapter is the workaround, not a resolution | |
| **Seat funding** | Gateway seat `0x18AE…663c` has 0 ETH on chain 4663 | CO | **OPEN** — `UNVERIFIABLE-FROM-REPO` | |
| **External audit** | Gate for any third-party funds | all | **OPEN** — scope package `docs/developers/lp-gateway-external-audit-scope.md` present | |
| **Two-person pool sign-off** | Curation policy §5 | CO | **OPEN**; curator allowlist table in `mainnet-path.md` still empty | |
| **USDG issuer monitoring** | Watch `Upgraded` on `0x5fc5…d168` and `CallScheduled` on the RH timelock | R3 | **OPEN (monitoring)** — sole proposer/executor/canceller of both timelocks is one EOA behind a 24 h delay | |
| **Prod migrations** | `20260908000001/2/3`, `20260908000010`, `20260907000003` | CO/R3 | Files present; **application `UNVERIFIABLE-FROM-REPO`** | |
| **Privy per-seat auth keys (O-6)** | `GATEWAY_ORACLE_PRIVY_AUTH_KEY` / `ROOT_ORACLE_PRIVY_AUTH_KEY` attached as wallet owners | CO | Code path present (`deploy-lp-gateway-mainnet.mjs:229-232`); dashboard state **`UNVERIFIABLE-FROM-REPO`** | |
| **Vercel env** | `LP_GATEWAY_*` repointed to rig 'g' | R3 | **Consistent with observed behaviour** (rig 'g' answers as the registry-resolved live instance); values **`UNVERIFIABLE-FROM-REPO`** | |

### 3.6 PR #483 (pending) — new items

| ID | Item | Sev | Status (verified today) | Discrepancy? |
|---|---|---|---|---|
| **483-1** | `MintwareIdleYieldAdapter.sol` is a genuinely new, self-contained file; gateway contracts untouched | — | **CONFIRMED** — `git diff main …-- contracts-v4/src/gateway/` is **empty**; new file at `contracts-v4/src/vaults/MintwareIdleYieldAdapter.sol` (144 lines, 18 tests) | |
| **483-2** | Idle mode does not short-circuit any other preflight check | — | **CONFIRMED** — `preflight…mjs:229-255` is a branch with no early exit; §§1,2,4,5,6 all run (see §2a) | |
| **483-3** | Idle mode runs every post-wire assertion the real path does, plus two | — | **CONFIRMED** — `deploy…mjs:272-307` (see §2b) | |
| **483-4** | `LP_GATEWAY_DEPOSIT_CAP` is required in idle mode; `0` valid, unset rejected | — | **CONFIRMED** — enforced twice: `preflight…mjs:235` and `deploy…mjs:144-146` | |
| **483-5** | Cap-exceeded surfaces as a **deposit revert** (`DepositCapExceeded`), matching a capped 4626's own behaviour; the `deploy` re-stage path is protected | — | **CONFIRMED** — adapter `:110`; PM re-stage is inside `try/catch` at `…PositionManager.sol:732-733`; unguarded `staging.stage` calls at `:448` (deposit) and `:789` are the intended bound | |
| **483-6** | 🚨 **No app/API/UI code is idle-mode aware; the UI would keep claiming "Idle in Morpho · earns lending yield" over a zero-yield adapter** | **Medium (copy/UX on a money surface)** | **CONFIRMED OPEN** — `grep IDLE_MODE\|IdleYield\|idleMode lib app components` → **0 hits**; `V1PoolDetail.tsx:384` unchanged; `/api/gateway/meta` exposes no adapter kind | 🚨 **YES — see D-4** |
| **483-7** | `BigInt(process.env.LP_GATEWAY_DEPOSIT_CAP)` throws uncaught on a malformed value (both scripts) | Info | **CONFIRMED** — `preflight…mjs:140`, `deploy…mjs:147`. Fails loudly and pre-deploy, so it is fail-closed, but the error is a raw `SyntaxError` rather than a preflight FAIL row | |

**Total tracked: 100 distinct findings / residuals** (36 re-verified FIXED, 41 ACCEPTED-and-still-true,
14 OPEN-and-still-true, 9 ops/unverifiable-from-repo). **4 discrepancies.**

---

## 4. 🚨 Discrepancies found

### D-1 — `invariant-fuzzing.md` §0 still calls R3-INV-3 an OPEN MEDIUM. It is fixed, on `main` and on-chain. *(Most important.)*

**What the report says.** `docs/developers/audits/round3/invariant-fuzzing.md`:
- §0.1 verdict table: **"R3-INV-3 … NEW residual — MEDIUM (bounded window)"**
- §0.2 Suite-B table: B8 marked **"FAIL in the R3-INV-3 window"**
- §0.4 heading: **"R3-INV-1 / R3-INV-2 FIXED (flipped), R3-INV-3 NEW (real, pinned)"**
- §0.4 body, verbatim: **"Fix direction (not applied — `src/` out of scope)"**, and it names the pinned test
  `test_R3_INV3_entryMemoryUnsetBucket_zeroHolderMark_quoteIsCurrency0_depositsUnderMinted_RESIDUAL`.

**What the code does.** `contracts-v4/src/gateway/MintwareLpGatewayPositionManager.sol:372-381`:

```solidity
///      Zero is "unset", never a price (round-3 R3-INV-3: an unset bucket compared as sqrtPrice 0 marked the LP leg
///      at its range-edge maximum on quote-is-currency0 pools for the first entry period after creation).
function _marksHigher(uint160 a, uint160 b) internal view returns (bool) {
    if (a == 0) return false;          // ← line 378: the exact fix §0.4 says was "not applied"
    if (b == 0) return true;
    return quoteIsCurrency0 ? a < b : a > b;
}
```

**Corroboration, three independent ways.** (1) The regression test has already been renamed and rewritten to assert
post-fix behaviour: `contracts-v4/test/audit3/InvariantForkRegressions.t.sol:553` is now
`test_R3_INV3_…_depositsUnderMinted_FIXED`, asserting `entryHigh == ref0` right after construction and
`bobShares == predSpec`. The `_RESIDUAL` name §0.4 cites **no longer exists in the repo**. (2) `round3/README.md:55`
already records R3-INV-3 as **✅ fixed**. (3) **On-chain**: `referencePrice()` on rig 'g' returns
`entryHighSqrtPriceX96 = 79228162514264337593543950336` — non-zero, i.e. an unset bucket is being ignored rather
than read as 0, on a rig whose `quoteAsset()` **is** `currency0` (the exact orientation the fix guards).

**Direction:** safe — the code is better than the document. **Why it still matters:** the brief for this review was
"check `invariant-fuzzing.md` §0 for the final state", and §0 gives the wrong answer. That file is the deep-dive an
external audit firm would be handed alongside the scope package; it currently tells them a live MEDIUM exists in
the deployed bytecode. **Fix:** update §0.1's verdict row, §0.2's B8 row, and §0.4's R3-INV-3 paragraph to FIXED,
citing `…PositionManager.sol:378` and the `_FIXED` test name.

### D-2 — `.claude/rules/deployments.md:132` still describes O-9 as open and mis-states a money-moving default.

**What the doc says**, verbatim:

> `LP_GATEWAY_DEPLOY_MIN_LIQUIDITY` … `0` … Absolute-`L` slippage floor passed to `deploy()`. **`0` ⇒ the cron
> REFUSES to deploy** (A-3). One global value for all pools — O-9 (per-pool compute-from-spot) is still open.

**What the code does.** `lib/gateway/deploy.ts:69-81` — `computeDeployMinLiquidity` mirrors the contract's own
`LiquidityAmounts.getLiquidityForAmounts(spot, A, B, amount0, amount1)` **per pool, from spot**, haircut by
`LP_GATEWAY_DEPLOY_TOL_BPS`. The env value is now only an **additional** floor (`:80`, `envFloorApplied = env >
computed`), i.e. `LP_GATEWAY_DEPLOY_MIN_LIQUIDITY=0` no longer means "refuse" — it means "no operator floor, use
the computed one". The A-3 *safety property* is still enforced, just by a different mechanism: `:314` refuses with
`min_liquidity_unset` when the **computed** floor is 0, and `:311-313` refuses `out_of_range`. The close-out
(`closeout/README.md`, O-9 row) already records this as ✅ fixed.

**Direction:** safe (the code is strictly stronger). **Why it matters:** an operator reading the rule file would
believe leaving the var at `0` is a kill-switch. It is not — deploys will proceed on the computed floor once
`LP_GATEWAY_DEPLOY_ENABLED=true`. That is a misleading description of a money-moving knob.

**Related, same file, same root cause (O-14 "docs drift ✅ fixed" is only partially true today):** the
`LP_GATEWAY_*` env table in `.claude/rules/deployments.md` carries its own instruction — *"re-run that grep when
you add one"* — and it has not been re-run. Read by code but **absent from the table**: `LP_GATEWAY_OWNER` and
`LP_GATEWAY_HARVEST_RECIPIENTS` (both are the **F-5 registry seat-check trust anchors** — `lib/gateway/registry.ts:104,
114, 116` — and the registry **fails closed** without them), `LP_GATEWAY_PM_CODEHASHES`, `LP_GATEWAY_CURATORS`,
`LP_GATEWAY_FACTORY`, `LP_GATEWAY_MIN_POOL_LIQUIDITY`, `LP_GATEWAY_MIN_POOL_USDG`, `LP_GATEWAY_ALLOW_ADMIN_TOKEN`,
`LP_GATEWAY_POOL_ID`/`_CURRENCY0`/`_CURRENCY1`/`_FEE`/`_TICK_SPACING`/`_HOOKS`, `LP_GATEWAY_DEPLOY_TOL_BPS`,
`LP_GATEWAY_MULTICALL3`, `LP_GATEWAY_LEDGER_INDEX_ENABLED`, the five `LP_GATEWAY_INDEX_*` vars,
`LP_GATEWAY_HARVEST_RECIPIENT`, and (new in #483) `LP_GATEWAY_IDLE_MODE` / `LP_GATEWAY_DEPOSIT_CAP`.

### D-3 — Close-out record still lists a build break that is already fixed.

`docs/developers/audits/closeout/discovery-hygiene.md` (O-13/build section) records, as **"OPEN — lead action"**:

> `Type error: Route "app/api/gateway/leaderboard/route.ts" does not match the required types of a Next.js Route.
> "__resetLeaderboardCache" is not a valid Route export field.`

**Current code:** `app/api/gateway/leaderboard/route.ts` exports only `dynamic` (`:8`) and `GET` (`:92`). The cache
was moved out to `lib/gateway/leaderboardCache.ts` (`:40-42`, comment: *"lives in lib/gateway/leaderboardCache.ts
(route modules may only export handlers)"*). The `__resetLeaderboardCache` export **does not exist**. Direction:
safe. Fix: mark it done.

### D-4 — Live UI copy contradicts three accepted residuals, and PR #483 turns one of them into a false statement.

This is the one discrepancy that is **not** merely stale documentation. HO-17 was logged in round 2 as
"CONFIRMED (code)", handed to the components owner in `closeout/discovery-hygiene.md` ("O-14 items … **Left for
their owners**"), and **never fixed**. All three strings are still live in
`components/web2/v1/V1PoolDetail.tsx`:

| Line | Live string | Contradicted by |
|---|---|---|
| `:384` | `"Idle in Morpho"` · `"earns lending yield · zero IL"` · `"≥50%"` | Today: the testnet rig's source is a **`MockERC4626`**, not Morpho (`config/deployments.json`, `LpGateway_MockERC4626YieldSource`). Under **PR #483** with `LP_GATEWAY_IDLE_MODE=true` there is **no yield source at all** and the yield is **exactly zero** |
| `:390` | `"always in range, no rebalancing"` | XR-2 residual + `DeployNotTwoSided` (round-3 README §2, verbatim): *"deploys within roughly the outer third of the range are now refused"* — and a wide range is not "always" in range |
| `:545` | `"Locks anything? — No — withdraw anytime"` | **C-9a residual** (accepted, verified above): the adapter owner can set `perBlockWithdrawCap` and soft-lock exits indefinitely (RT-7d); plus C-10's `SourceUnavailable` outage path |

**Why #483 makes it worse rather than neutral.** The PR ships a zero-yield adapter *and its own honest admission*
(`closeout/mainnet-yield-sources.md` §4: *"The honest cost is real: the product's 'earns immediately' claim does
not hold while idle mode is on"*) — but the PR contains **no UI change and no API surface** by which the UI could
even learn it is in idle mode. `grep -rn "IDLE_MODE|IdleYield|idleMode" lib app components` returns **zero hits**,
and `/api/gateway/meta` (`app/api/gateway/meta/route.ts:95-118`) returns no yield-source or adapter-kind field.
So if `LP_GATEWAY_IDLE_MODE=true` were ever set on a deployed instance, the product page would state
*"Idle in Morpho — earns lending yield"* about capital that earns nothing, with no code path capable of correcting
it. Against this repo's own hard copy lines (no *deposit / savings / guaranteed / fixed-APY*, "testnet-honest",
est. APR is an estimate), that is a violation, not a nit.

**Recommended (not applied — this review is read-only):** add an `idleMode` / `yieldSourceKind` field to
`/api/gateway/meta`, derive the allocation-row copy from it, and change `:384`/`:390`/`:545` to the honest
formulations before `LP_GATEWAY_IDLE_MODE` is ever set on any instance.

---

## 5. Verdict

**Yes — my re-verification found four places where a report's claim does not match what the current code does, and
one of them is in exactly the file this review was told to treat as authoritative.** Round 3's own deep-dive,
`invariant-fuzzing.md` §0.1/§0.4, still presents **R3-INV-3 as an open MEDIUM** with the words *"Fix direction (not
applied — `src/` out of scope)"*, while the fix is sitting at `MintwareLpGatewayPositionManager.sol:378`
(`if (a == 0) return false;`), the pinned counterexample has already been renamed from `_RESIDUAL` to `_FIXED`,
`round3/README.md:55` records it fixed, and the live rig's `referencePrice()` returns a non-zero `entryHigh` on a
quote-is-currency0 pool — the direct on-chain observable of that fix — from bytecode whose keccak hash I recomputed
and matched exactly against the recorded `0x89a53e8d…00f4`. The other three are: `.claude/rules/deployments.md:132`
describing O-9 as open and mis-stating `LP_GATEWAY_DEPLOY_MIN_LIQUIDITY=0` as a deploy kill-switch when it is now
merely "no operator floor" (**D-2**, plus ~20 `LP_GATEWAY_*` vars — including the two F-5 registry trust anchors
`LP_GATEWAY_OWNER` / `LP_GATEWAY_HARVEST_RECIPIENTS` — missing from the table that O-14 claims is complete); a
close-out record still listing the `__resetLeaderboardCache` build break as open when the export is gone
(**D-3**); and **HO-17**, which is not stale documentation at all but a genuine, still-live copy defect
(*"Idle in Morpho — earns lending yield"*, *"always in range"*, *"withdraw anytime"* at
`V1PoolDetail.tsx:384/390/545`) that **PR #483 converts from misleading into false**, because the PR ships a
zero-yield adapter with zero UI or API awareness of it (**D-4**).

**Three of the four are documentation lagging behind code that is strictly safer than advertised — no security
regression, nothing to un-ship.** The fourth, D-4, is a real gap that should be closed before
`LP_GATEWAY_IDLE_MODE` is ever set on a live instance. And the specific thing the brief was most worried about —
that the idle-mode branch might silently short-circuit past unrelated preflight checks or post-wire assertions,
quietly reopening a closed finding — **does not happen**: the preflight branch at `preflight…mjs:229-255` has no
early exit and every USDG-freeze, pool-band/liquidity, tick, hook and paired-token-admin-control check still runs;
the deploy script's post-wire block at `deploy…mjs:272-307` runs **more** assertions in idle mode, not fewer; and
`git diff main feat/lp-gateway-idle-yield-adapter -- contracts-v4/src/gateway/` is **empty**, so the
round-3-hardened, rig-'g'-deployed contracts are untouched by the pending PR.
