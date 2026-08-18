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

### Phase 0 — delete dead weight ✅ DONE (2026-08-15)
> **COMPLETE.** Migrated the 4 `MWHookCoordinator*.t.sol` suites (25 tests incl. 2 am-AMM invariants)
> onto `MintwareDeFiPairVault` — no assertion dropped (commit `622a6eaf`). Then deleted the deprecated
> single-sided stack + its 4626-bound factory: `MintwareDeFiVault4626`, `MintwareBaseVault4626`,
> `MintwareVaultFactory`, their two tests, and the orphaned `VaultConfig` struct (commit `fda07a61`,
> −1,971 lines). **Vault contracts 9 → 7.** Factory retired per decision (it only deployed the deprecated
> vault; the real multi-tenant factory is Phase 3). Registry kept (independent). Full suite green: 38 suites,
> 400 passed / 0 failed / 4 skipped. The historical record below is kept for context.

> ⚠ **NOT a drive-by delete — it was a focused test-migration (fully traced 2026-08-15).** Findings:
> - `MintwareDeFiVault4626` (DO-NOT-DEPLOY) is the concrete vault fixture for the 4 `MWHookCoordinator*.t.sol`
>   tests **and** `MintwareVaultFactory.t.sol` (`createVault` with `type(MintwareDeFiVault4626).creationCode`).
> - GOOD: `MWHookCoordinator` is **canonical + vault-agnostic** (`IMWJitVault`), and `MintwareDeFiPairVault`
>   uses it too. The HOOK's am-AMM/surge/JIT behavior is already covered against the canonical vault by
>   `MintwareDeFiPairVaultJit(.t/Invariant).t.sol`, `MWAmAuction.t.sol`, `MWPairVaultAmAmmFork.t.sol`. So the
>   *hook* coverage does not depend on the 4626.
> - BLOCKER: those ~5 tests are bound to the 4626's **single-sided API** (`VaultConfig`/`seedTeamTokens`/
>   `rebalance`/`depositWithLock`/`entryFeeBps`). Deleting the 4626 needs them **rewritten onto the pair
>   vault's dual-sided lifecycle** (commit-team → community-match → activate) — a real rewrite that touches
>   the frontier am-AMM hook tests, and is naturally coupled to the **deploy-gated pair-vault cutover**.
> - `FeeLib`/`FeeVault` were too entangled to touch (44–109 file matches = mostly v4-core dep noise).
- **Revised Phase 0 (its own PR, rides with the pair-vault cutover):** (1) rewrite `MWHookCoordinator*.t.sol`
  + `MintwareVaultFactory.t.sol` onto `MintwareDeFiPairVault`; (2) confirm am-AMM auction + surge + JIT
  assertions transfer (not just wiring); (3) delete `MintwareBaseVault4626` + `MintwareDeFiVault4626` +
  `MintwareDeFiVault4626.t.sol`; (4) drop retired instances from `MintwareVaultRegistry`. **9 → 7**, guarded
  by the migrated suites staying green. Do NOT rush as a bulk edit — it's frontier-hook test surface.

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
