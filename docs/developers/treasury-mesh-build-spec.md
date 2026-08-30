# Treasury Mesh — Build Spec (v0.1)

> **Companion to** [`treasury-mesh-shared-liquidity-spec.md`](./treasury-mesh-shared-liquidity-spec.md)
> (the design/why). This is the **how**: concrete interfaces, storage, functions, tests, and per-phase
> acceptance criteria — the plan an engineer executes against. Every phase is flag/env-gated OFF and
> testnet-only; **external audit of the converged cross-vault credit stack is the hard gate before real
> value.** Signatures below are pulled from the live code (file:line) so the delta is exact.

## 0. Build principles

1. **Reuse-first.** ~85% ships. Do not reinvent the JIT engine, coverage math, senior-share math, 6909
   settlement, the multi-venue adapter, the registry, or edge-auth's multi-leg guard. The delta is a
   *coordinator* that relocates the funding source of the existing seam from "my own vault" to "the network."
2. **Additive + flag-gated.** No behavior change to existing single-vault flows. A pair hook falls back to
   its own vault when `allocator == address(0)`. Every new surface gated (env/flag) OFF by default.
3. **Invariant-tested at every phase.** Each phase ships Forge invariants proving the safety invariants
   (INV-1…8 in the design spec) before the next phase starts. Mirror the existing YPN invariant suite.
4. **Fail-closed, timelocked + breaker.** Reuse `MWTimelockedRiskParams` (48h) for risk params + an
   instant-trip breaker (mirror `jitAutoDisabled`). Off-chain services fail-closed like edge-auth/relayer.
5. **Atomic-JIT first, standing later.** Ship the provable-safe atomic path (Tier A/B/C) to mainnet first;
   standing allocation (Tier A only) is a fast-follow after the coverage engine is battle-tested.

## 1. The seams we extend (exact, from code)

```solidity
// contracts-v4/src/payments/MintwareTreasuryJitHook.sol:27  — the funding ABI the hook drives today
interface IJitVault {
    function borrowIdleForJit(uint256 want) external returns (uint256 lent);   // onlyJitHook, coverage+per-block-cap gated
    function settleJitReturn(uint256 usdcReturned) external;                    // onlyJitHook, books junior first-loss on shortfall
    function jitBorrowed() external view returns (uint256);                     // outstanding par-counted slice
}
// vault side: MintwareTreasuryVault.sol:913 borrowIdleForJit(want) onlyJitHook nonReentrant;
//             :952 settleJitReturn(reported) onlyJitHook; :993 forceSettleJit() onlyOwner (stuck-slice backstop)

// contracts-v4/src/vaults/IYieldAdapter.sol  — how a supplier vault treats a venue
interface IYieldAdapter {
    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external returns (uint256 withdrawn);
    function totalAssets() external view returns (uint256);
    function maxWithdrawable() external view returns (uint256);
    function maxSuppliable() external view returns (uint256);
}

// coverage / NAV (MintwareTreasuryVault.sol): deployedFromSenior:151, juniorUsdcBuffer:170, minCoverageBps:181,
//   coverageBps():657, _coverageOkAfter(addl):663, totalSeniorAssets():552, seniorRealizableAssets():563, idleBuffer():638
// jit math (pool-agnostic, reuse as-is): MWJitLib.{Ctx:41, open:73, close:143, sweep:178}

// edge-auth (services/edge-auth/src): ledger.rs Account:13, Global:26, available():69;
//   portfolio.rs Leg:22, PortfolioGuard:44, portfolio_available(legs,acct,guard):63   ← a "leg" = a deployed slice
```

## 2. Component inventory (new vs extend)

| Component | Kind | Delta |
|---|---|---|
| `MintwareLiquidityAllocator.sol` | **NEW** | The one coordinator. Implements the borrow-seam for hooks + a supply-seam for adapters. §3. |
| `NetworkYieldAdapter.sol` | **NEW** | Thin `IYieldAdapter` so a supplier vault commits to the mesh as one weighted venue. §4. |
| `MintwareTreasuryJitHook.sol` | EXTEND | Funding pointer: call the allocator (with its `canonicalPoolId`) instead of its own vault when an allocator is set. §5. Additive; falls back to own vault. |
| `MWJitLib` | REUSE as-is | Pool-agnostic open/close/sweep. No change. |
| `MintwareTreasuryVault` coverage/NAV | REUSE (read) | Allocator reads borrower vault's `juniorUsdcBuffer`/`coverageBps`. No change to the vault. |
| Allocation Service (Rust) | **NEW** | Sibling to edge-auth/relayer. Matching, ranking, recall orchestration, feeds edge-auth legs. §6. |
| edge-auth `portfolio.rs` + `refresher.rs` | EXTEND | Populate `Leg`s from network slices; `spendable` spans deployed positions. §6. |
| Registry/factory | EXTEND | Record `supplies`/`borrows` flags per team. |
| Schema `network_*` | **NEW** | `network_allocations`, `network_positions`, `network_fee_accruals` (deny-all RLS). §7. |

## 3. `MintwareLiquidityAllocator.sol` (the net-new coordinator)

### 3.1 Interface

```solidity
interface ILiquidityAllocator {
    // ── Borrow side — a pair's JIT hook calls THIS instead of IJitVault ──
    function borrowForJit(bytes32 pairId, uint256 want) external returns (uint256 lent);   // onlyRegisteredHook(pairId)
    function settleJitReturn(bytes32 pairId, uint256 usdcReturned) external;                // onlyRegisteredHook(pairId)
    function deployedInto(bytes32 pairId) external view returns (uint256);
    function coverageOkAfter(bytes32 pairId, uint256 addl) external view returns (bool);

    // ── Supply side — a supplier vault's NetworkYieldAdapter calls THIS ──
    function supply(address supplierVault, uint256 amount) external returns (uint256 shares);      // pulls USDC, mints shares
    function requestRecall(address supplierVault, uint256 amount) external returns (uint256 recalled);
    function supplierParAssets(address supplierVault) external view returns (uint256);             // idle + deployed@par + accrued fees
    function supplierLiquidNow(address supplierVault) external view returns (uint256);             // hot buffer + atomically-recallable

    // ── Risk / ops ──
    function forceRecall(bytes32 pairId, address supplierVault) external;                          // mirror forceSettleJit; onlyKeeper/owner
    function tripBreaker() external;                                                               // instant halt (guardian)
}
```

### 3.2 Storage (shape)

```solidity
// supplier ledger — SeniorSharesMath against networkTotalAssets = Σ idle + Σ deployed@par + Σ accruedFees
mapping(address => uint256) public supplierShares;      // supplierVault => shares
uint256 public totalSupplierShares;
uint256 public idleUsdc;                                // un-deployed, held by the allocator
uint256 public accruedFees;                             // fees credited, not yet distributed

// per-pair deployed tally + open-slice attribution
mapping(bytes32 => uint256) public deployedInto;        // pairId => Σ senior slices live in that pair
struct OpenSlice { address supplier; uint96 amount; uint32 openBlock; }
mapping(bytes32 => OpenSlice[]) internal _open;         // pairId => outstanding slices (for attribution + forceRecall)

// per-pair config (tier params, curated) — timelocked
struct PairRisk { uint16 minCoverageBps; uint16 ocWithdrawBps; uint16 ocLiqBps; uint16 lgdBps; uint16 juniorHaircutBps; uint96 perPairCap; uint8 tier; bool standingAllowed; bool eligible; }
mapping(bytes32 => PairRisk) public pairRisk;           // pairId => curated risk config (RP_* timelocked)

// supplier knobs
struct SupplierCfg { uint16 networkCommitBps; uint16 hotBufferBps; uint96 minRecallable; uint16 perPairCapBps; bool allowStanding; }
mapping(address => SupplierCfg) public supplierCfg;

address public borrowerVaultFor; // pairId => borrower vault (to read its junior); via registry
bool public breakerOpen;
```

### 3.3 Core logic

**`borrowForJit(pairId, want)`** (the hot path, called inside the hook's `unlock`):
1. `require(!breakerOpen)`; `require(pairRisk[pairId].eligible)` (curation gate); `require(msg.sender == hookFor[pairId])`.
2. **Network coverage gate** (mirror `_coverageOkAfter`, keyed cross-vault):
   ```
   jb = ITreasuryVault(borrowerVault[pairId]).juniorUsdcBuffer();          // borrower's first-loss
   require(jb * BPS >= pairRisk[pairId].minCoverageBps * (deployedInto[pairId] + want));   // B's junior covers ALL network slices in B
   require(deployedInto[pairId] + want <= pairRisk[pairId].perPairCap);    // per-pair concentration
   require(idleUsdc >= want + _reservedHotBuffer());                       // global utilization / recall solvency
   ```
3. Choose supplier(s) with headroom (pre-ranked by the Allocation Service; on-chain picks from a supplied
   allocation hint or round-robins idle). Debit `idleUsdc`, push slice to `_open[pairId]`, `deployedInto[pairId] += want`.
4. Transfer `want` USDC to the hook. Return `lent`.
   *(Senior par preserved: the slice is `deployed@par` in `supplierParAssets`, so ownership is unchanged; only `idleUsdc`/liquidity drops.)*

**`settleJitReturn(pairId, usdcReturned)`** (called by the hook after `sweepJit`):
1. Match against `_open[pairId]` (FIFO) to attribute par + fee to the right supplier(s).
2. `principalPortion → idleUsdc` (supplier's par restored); `feePortion → accruedFees` credited pro-rata to
   the slice's supplier(s); **shortfall (returned < par) → book against `borrowerVault`'s junior** (call a
   borrower-vault hook that debits `juniorUsdcBuffer`, exactly as single-vault `settleJitReturn` books junior
   first-loss today). `deployedInto[pairId] -= principal`.

**`forceRecall(pairId, supplier)`** — the stuck-slice backstop (mirror `forceSettleJit`): if an open slice's
`openBlock` is older than `maxOpenWindow`, book it as a borrower-junior-absorbed loss (never leave it
phantom-at-par), clear it from `_open`, restore what's recoverable to `idleUsdc`.

**`supply` / `requestRecall`** — supply mints `SeniorSharesMath.toShares(amount, networkTotalAssets, totalSupplierShares)`;
recall serves from `idleUsdc` first (hot buffer honored), returns `min(request, liquidNow)`; the rest waits
for the next sweep. **Never break par to satisfy a recall.**

### 3.4 Invariants to prove (Forge)

- **A-INV-1** `supplierParAssets(A)` is monotonic across a full borrow→settle round with a paying pair (par preserved).
- **A-INV-2** after any `settleJitReturn` with a shortfall, `Δ(borrower junior) == shortfall` and `Δ(supplier par) == 0`.
- **A-INV-3** `Σ deployedInto + idleUsdc == Σ supplier principal` (no phantom par; claims accounted) — the network solvency identity.
- **A-INV-4** `deployedInto[i] * BPS <= juniorBuffer(i) / minCoverageBps` holds after every `borrowForJit` (coverage).
- **A-INV-5** isolation: a forced loss in `pairId=i` changes no `supplierShares` attributable solely to slices in `j≠i`, and never touches `idleUsdc` reserved as hot buffer.
- **A-INV-6** `forceRecall` on a stranded slice can never book a loss > that slice's amount, and never > borrower junior.
- **A-INV-7** a `requestRecall` never returns > `supplierLiquidNow`, and never reduces another supplier's par.

## 4. `NetworkYieldAdapter.sol`

Thin `IYieldAdapter` bound to `(supplierVault, allocator)`:
- `deposit(amount)` → `allocator.supply(supplierVault, amount)`.
- `withdraw(amount)` → `allocator.requestRecall(supplierVault, amount)` — **utilization-bounded, best-effort,
  never-revert** (mirror `MintwareMultiVenueYieldAdapter` withdraw semantics so the supplier vault's hot
  path can't be bricked by a busy mesh).
- `totalAssets()` → `allocator.supplierParAssets(supplierVault)`.
- `maxWithdrawable()` → `allocator.supplierLiquidNow(supplierVault)`.
- `maxSuppliable()` → supplier `networkCommitBps` headroom.

A supplier opts in by adding this as one weighted child venue in its existing `MintwareMultiVenueYieldAdapter`
(`networkCommitBps` = the weight). To the supplier vault, the mesh is "just another yield venue" — deployed
USDC still counts at par in `totalSeniorAssets()`, so the senior NAV shape is unchanged.

## 5. Hook change (additive)

In `MintwareTreasuryJitHook`, replace the direct `IJitVault(vault)` calls with an allocator-aware funding
pointer:

```solidity
address public allocator;   // set by factory/registry; address(0) => legacy own-vault path
function _fund(uint256 want) internal returns (uint256) {
    if (allocator == address(0)) return IJitVault(vault).borrowIdleForJit(want);        // unchanged legacy path
    return ILiquidityAllocator(allocator).borrowForJit(canonicalPoolId, want);           // network path
}
function _return(uint256 got) internal {
    if (allocator == address(0)) { IJitVault(vault).settleJitReturn(got); return; }
    ILiquidityAllocator(allocator).settleJitReturn(canonicalPoolId, got);
}
```

`canonicalPoolId` already exists as an immutable on the hook, so the pair identity is free. No other hook
logic changes; the 6909-claim + `sweepJit` timing solution is reused verbatim, with returns routed to the
allocator.

## 6. Allocation Service (Rust) + edge-auth legs

**New crate `services/allocation`** (sibling to `edge-auth`, `relayer`; fail-closed bearer + RPC):
- **Match/rank:** watches the registry for pairs with JIT demand + suppliers with headroom; ranks
  `(supplier × pair)` by expected fee capture, coverage health, utilization. Emits allocation hints the
  allocator uses to pick suppliers (or the allocator round-robins idle if no hint).
- **Recall/rebalance orchestration:** triggers `sweepJit`/`forceRecall` fan-out; rebalances standing slices.
- **Feeds edge-auth:** pushes per-supplier **legs** to the edge-auth NAV refresher so
  `portfolio_available(legs, acct, guard)` spans the whole network position.

**edge-auth extension (`portfolio.rs`/`refresher.rs`):** each network-deployed slice becomes a `Leg` whose
`settleable()` = 0 for standing-not-yet-recallable, = full for atomic-next-sweep, so:
```
spendable(A) = Σ equity(all legs) − holds − hotBuffer      // ownership counts; only recallable liquidity is settleable
```
This is the concrete wiring of the universal rule's LIQUIDITY gate across deployed positions — no chain read
in the hot path.

## 7. Schema (`network_*`, deny-all RLS, service-role only)

- `network_allocations` — `id, supplier_vault, pair_id, borrower_vault, amount_atomic, mode('atomic'|'standing'), status('open'|'settled'|'recalled'|'stranded'), open_block, settle_tx, fee_atomic, created_at, settled_at`.
- `network_positions` — per-supplier rollup: `supplier_vault, idle_atomic, deployed_atomic, accrued_fee_atomic, shares, updated_at`.
- `network_fee_accruals` — `pair_id, epoch, gross_v_atomic, mintware_take, senior_coupon, junior_residual, created_at`.

Mirror `x402_settle_events` / `20260819000001` RLS posture (browser never reads; a server route on the
service-role client exposes a supplier's own rows).

## 8. Phased plan + acceptance criteria

**Phase 0 — Seam generalization (single supplier → single borrower).**
- Ship `MintwareLiquidityAllocator` (supply ledger + borrow-seam + network coverage gate + `forceRecall`),
  the hook funding-pointer change, `NetworkYieldAdapter`.
- Prove atomic cross-vault JIT on **Base Sepolia** end-to-end via the existing 6909-claim + `sweepJit` path,
  one supplier vault A funding one borrower pair B.
- **Accept when:** A-INV-1…6 green in Forge; a real Base-Sepolia round (A funds B's swap, earns fee, A par
  preserved, B junior books any shortfall) recorded with tx hashes; everything flag-gated off; `pnpm forge:test`
  stays green.

**Phase 1 — Network adapter + N→N accounting.**
- Supplier shares via `SeniorSharesMath`; fee attribution on sweep; N suppliers × N borrowers via the registry;
  `network_*` schema; edge-auth `portfolio.rs` legs + refresher so `spendable` spans slices.
- **Accept when:** A-INV-3/7 hold under N-supplier fuzzing; edge-auth `cargo test` green with multi-leg
  network scenarios; a supplier's `spendable` correctly drops by deployed-not-recallable and restores on sweep.

**Phase 2 — Recall + utilization + standing mode.**
- Utilization caps, recall queue + priority ladder, supplier knobs; opt-in **standing** allocation (Tier A)
  with utilization-bounded recall + premium; per-pair caps tiered by junior coverage; Allocation Service does
  matching/ranking/orchestration.
- **Accept when:** a stress test (correlated recall + a Tier-C crash) shows par never broken, isolation holds
  (A-INV-5), and `reserve_floor_breached` decline fires correctly; standing-mode invariants green.

**Phase 3 — Ops, observability, audit gate.**
- Network sweep/recall keeper + cron; timelocked risk params + instant breaker wired; `/proof`-style network
  dashboard; the curation allow-list surface.
- **Accept when:** the full stack runs on testnet under an ops runbook; **external audit engaged** on the
  cross-vault credit stack. Audit sign-off + counsel sign-off = the only gate to mainnet real value.

## 9. Test strategy

- **Forge invariants** (per phase, 256×128k depth like the YPN suite): the A-INV set above + a network
  solvency invariant (`Σ deployed@par + idle + Σ claims ≥ Σ supplier par`).
- **Forge fork tests** (self-skip without `BASE_RPC_URL`): a real v4 pool JIT round funded by the allocator.
- **edge-auth `cargo test`:** multi-leg `portfolio_available` with network legs; hot-buffer + breaker paths.
- **Vitest:** the Allocation Service matching/ranking + the `network_*` route auth/RLS + the supplier
  spendable read.
- **Adversarial (red-team, like prior rounds):** the §8.6 audit risks — open→sweep credit window, 6909
  mis-attribution, recall-vs-spend race.

## 10. Audit checklist (the three load-bearing risks)

1. **Open→sweep cross-vault credit window** — A's slice out-at-par backed only by B's junior; reproduce the
   single-vault `seniorRealizableAssets`/`forceSettleJit` solvency fix at network level; bound the open-slice
   cap so a stranded slice ≤ B junior.
2. **6909-claim attribution** — fungible per-currency; supplier attribution lives only in the allocator
   ledger. Prove a reconciliation invariant: attributed fees/losses sum to the claim exactly.
3. **Recall-vs-spend race** — the hot buffer + `reserve_floor_breached` decline must guarantee a supplier can
   always spend its non-committed balance; par is never broken to satisfy a recall.

## 11. Dependencies & sequencing note

The universal spend rule + `spendableForParty()` (the treasury-spend track, `#2a`) is the **foundation** —
the mesh's LIQUIDITY gate is literally `portfolio_available` spanning network legs. Land that (route vendor
pay/payroll through edge-auth per-payer) before Phase 1's edge-auth leg extension, so there's one spend-limit
code path the mesh plugs into rather than two. Phase 0 (contracts) can proceed in parallel with `#2a`.
