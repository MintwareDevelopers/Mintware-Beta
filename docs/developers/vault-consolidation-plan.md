# Vault Consolidation Plan

_Companion to [`vault-architecture-map.md`](vault-architecture-map.md). Decision (2026-08-15): **fold
YPN onto the `MintwarePairVault` base** — specifically its matched-liquidity lineage. This is a **roadmap**
(the YPN stack is parked); it sequences the convergence for when the vault stack is next opened._

## The key realization

`MintwareMatchedLiquidityVault` and YPN's `MintwareTreasuryVault` are the **same skeleton**:

| Concept | MatchedLiquidityVault | YPN TreasuryVault |
|---|---|---|
| Team commits its own token as one side | `commitTeam(...)` | `commitTeam(...)` |
| Community provides the quote (USDC) side | `depositCommunity` | `depositUSDC` |
| Team side locked, hard cliff | lock + `NOTICE_PERIOD` | `lockExpiry` (≥90d) |
| Team's fees redirected to community during lock | team units excluded from fee denom | `teamFeesRedirected` |
| Guardian kill-switch + V4 settlement | via `MintwarePairVault` | duplicated in `V4LiquidityModule` |

**YPN = MatchedLiquidityVault + four layers it doesn't have:** ① price-free **par-senior** NAV (community
USDC redeemable 1:1, not LP-unit MTM) · ② **Aave rehypothecation** of idle senior (idle-first 80%) · ③ the
**JIT hook** seam (+ truncated oracle + PnL breaker) · ④ the **spendable gateway** (`burnForPayment`).

So the target is **not** a rewrite — it's: lift the shared skeleton into the base/lineage, then layer YPN's
four additions on top.

## One topology difference to resolve first

The pair vaults **hold the V4 position directly** (they `is IUnlockCallback`, do their own `modifyLiquidity`
+ settlement). YPN **delegates** to a separate `MintwareV4LiquidityModule` (passive full-range LP) + the
`JitHook`. That split is why YPN duplicates the V4 settlement code the base already owns.

**Decision for the fold:** absorb YPN's *passive* full-range LP into the vault (matching the pair-vault
topology, reusing `MintwarePairVault._settleDelta`/`_pay`), and keep **only the JIT as a separate hook**
(it must be — it's a V4 hook with permission bits). This removes `MintwareV4LiquidityModule` as a distinct
contract and its duplicated settlement.

## Phased plan (top-down, low-risk first)

### Phase 0 — delete dead weight (no behavior change, do immediately)
- Delete `MintwareBaseVault4626` + `MintwareDeFiVault4626` (both marked DEPRECATED / DO-NOT-DEPLOY in-code).
- Delete the dead `FeeLib` / `LockLib` / `IPyth` / dead FeeVault attestation (per the oracle-audit memory).
- Drop the retired instances from `MintwareVaultRegistry`.
- **9 vault contracts → 7.** Pure audit-surface reduction; existing tests are the guard.

### Phase 1 — extract shared bases (refactor, existing tests guard)
- **`SeniorShares` base:** `MintwareTreasuryVault` "lifts the senior share math verbatim" from
  `MintwareYieldVault`. Extract the senior-share + symmetric virtual-offset (now `1e6`) logic into one
  library/abstract both inherit — **one audited copy of the inflation defense.**
- **Shared V4 settlement:** ensure the settlement helpers used by YPN and the pair vaults are one audited
  copy (they already match line-for-line: `_settleDelta`/`_pay`). Point YPN at `MintwarePairVault`'s.

### Phase 2 — converge YPN onto the matched lineage (the real fold; deploy-gated; dedicated branch)
- Re-cast `MintwareTreasuryVault` as a `MintwarePairVault` subclass (sibling to `MatchedLiquidityVault`,
  sharing the team-commit / community-match / lock / fee-redirect skeleton — extract that into a shared
  `MatchedBase` if the overlap with MatchedLiquidityVault is high enough after a close read).
- Absorb the passive full-range LP from `MintwareV4LiquidityModule` into the vault; **retire the module.**
  Keep the `JitHook` as the one separate V4 hook.
- Layer the four YPN additions on top: par-senior NAV, Aave rehypothecation adapter, JIT seam, gateway.
- **Re-prove the invariants** (port the 256×128k handler suite) before this replaces the live TreasuryVault.
  The current vault is audited-hardened + green — convergence buys reduced surface + multi-tenancy, it does
  NOT fix a bug, so it must not regress safety. No big-bang: land behind a flag, diff invariants.

### Phase 3 — give YPN a factory (after Phase 2 shape settles)
- Make the converged YPN vault implement `IMintwareVaultInit` so `MintwareVaultFactory` deploys per-team
  instances; register in `MintwareVaultRegistry`. This is the multi-tenancy the "each team launches a vault
  with their own token" model needs — currently only the DeFi stack has it.

## What does NOT change (explicitly)
- `MintwareDeFiPairVault` (general balanced LP) and `MintwareMatchedLiquidityVault` (matched launch) stay as
  **two distinct products** — the base's NatSpec intends both; don't force-merge them. Target ② from the map
  resolves to "document the boundary," not "pick one."
- The `MintwarePaymentGateway` seam (`IYieldVault.burnForPayment`) is preserved — the gateway shouldn't care
  which vault base sits behind it.

## Sequencing & risk

| Phase | Risk | Gate |
|---|---|---|
| 0 delete dead weight | none (dead code) | do now |
| 1 extract shared bases | low (refactor) | existing unit + invariant suites |
| 2 converge YPN | **high** (security-critical rewrite) | ported invariants green + external audit; deploy-gated |
| 3 YPN factory | medium | after Phase 2 |

**Do Phases 0–1 whenever convenient (they only reduce surface). Phase 2 is the real work and belongs to a
deliberate "open the vault stack" effort with its own audit — not a drive-by.** The current YPN vault is
safe and green today; this plan is about long-term coherence, not an outstanding defect.
