# Vaults — DeFi LP / ULV

> **One home for the Vaults topic.** For platform-wide live/shelved status, [`.claude/STATE.md`](../STATE.md)
> wins over this file. MEV levers → [`smart-contracts.md`](smart-contracts.md); YPN card/settlement →
> [`deployments.md`](deployments.md) + [`session-handoff-arc.md`](../../docs/developers/session-handoff-arc.md).

> ⚠ **RECONCILE (2026-08-18):** honest status — **Base Sepolia only, empty, unaudited.** Present vaults
> as *"in testing on Base Sepolia,"* never *"deposit now."* External audit is the only gate left before
> real value. History note: the pre-2026-08 framing (two-surface DeFi+RWA; `SocialVault`/`MWSocialHook`/
> `LockLib`/`FeeLib`; the single-sided `MintwareDeFiVault4626`/`FeeVault`/`DeployPhase3` stack) is **dead** —
> those contracts were deleted or deprecated; **RWA is shelved.** Ignore any doc still citing them.

## What vaults are (today)

Dual-sided, reputation-adjacent DeFi liquidity on Uniswap **V4**. Every vault is **two-sided** — a team
commits its own token as one side, the community matches with the quote (USDC) side; team side is
lock-cliffed (≥90 days). Idle capital stays productive; the position is JIT-provisioned on swaps and
fees + MEV are captured and split. The canonical lineage is **`MintwarePairVault` → matched-liquidity**.

## Canonical contract map (`contracts-v4/src/`)

| File | Role | Status |
|---|---|---|
| `vaults/MintwarePairVault.sol` | **abstract dual-sided base** (guardian-pausable, holds its own V4 position, `_settleDelta`/`_pay`) | ✅ base |
| `vaults/MintwareDeFiPairVault.sol` | go-forward **general balanced LP** pair vault (~73KB — watch EIP-170) | ✅ canonical DeFi |
| `vaults/MintwareMatchedLiquidityVault.sol` | **team-locked / community-matched launch** vault (≥90d cliff) | ✅ canonical launch |
| `vaults/Mintwarev3ToV4Migrator.sol` | one-tx migrate a dormant Uniswap-v3 LP into the pair vault, mint shares | ✅ |
| `vaults/AaveV3YieldAdapter.sol` · `MintwareERC4626YieldAdapter.sol` | idle-capital yield seams (Aave rehypothecation; fee-aware Arc `previewRedeem` NAV adapter) | ✅ |
| `vaults/MintwareMultiVenueYieldAdapter.sol` | **curator multi-venue baseline yield** — one `IYieldAdapter` that fans idle capital across child adapters (Aave + Morpho/Euler via the 4626 adapter) by weight; best-effort never-revert withdraw; `setVenues`/`rebalance`. 12 tests | ✅ |
| `vaults/lib/MWJitLib.sol` · `MWIdleLib.sol` · `MWPositionLib.sol` | JIT / idle-rebalance / position math | ✅ |
| `vaults/MintwareVaultRegistry.sol` | multi-tenant registry — `deactivateVault`/`active` to retire instances | ✅ |
| `lib/SeniorSharesMath.sol` · `MWGuardianPausable.sol` · `MWTimelockedOracleSigner.sol` | shared bases (one audited inflation defense; kill-switch; timelocked signer) | ✅ |
| `hooks/MWHookCoordinator.sol` (+ `MWDynamicFee` / `MWOracleGuard` / `MWAmAuction`) | **canonical V4 hook** — vault-only LP, dynamic/surge fee, am-AMM MEV, oracle guard | ✅ |
| `payments/*` (`MintwareTreasuryVault` + factory/registry/gateway/JIT hook) | **YPN** treasury / spendable stack — folded onto the matched lineage | ✅ (see [YPN](#ypn) below) |

> **Two products, not a dup:** `MintwareDeFiPairVault` (balanced LP) and `MintwareMatchedLiquidityVault`
> (matched launch) both extend `MintwarePairVault` **on purpose** — don't force-merge. Boundary + adversarial
> findings: [`matched-vault-audit-2026-08-09.md`](../../docs/developers/matched-vault-audit-2026-08-09.md).

## ULV engine — live on Base Sepolia (in testing, unaudited)

The Universal Liquidity Vault loop: **deposit → shares · idle in Aave (rehypothecation) · V4 hook
JIT-provisions on swap · capture fees + MEV, split 60/30/10 · auto-rebalance.**

- Deployed **Base Sepolia only** — vault `0x6c0d…5132`, hook `0x9f3c…0AC8`. **Empty + unproven.** Never "deposit now."
- Mechanics/accounting specs: `docs/developers/ulv-*.md` (buffered-rehypothecation accounting, JIT lever-b,
  formal-verification, size-reduction). Reward rail = **vault-weighted epoch close** (`MintwareWeightedDistributor`
  + `cron/vault-weighted-epoch-close`), not per-tx.

## Pool tiering (key principle — not one-size-fits-all)

Blue-chip vs community/meme pools are **different products**; **tier every param by junior tier**:
- Naive JIT **bleeds on thin pools** (worse with size) → JIT off there; use dynamic/surge fee + LVR instead.
- Thin junior (4–8% slippage) → riskier senior backing → tighter card LTV + bigger idle buffer.
- MEV levers, card LTV, and buffer size all scale with junior tier — never a flat setting.

## YPN treasury / spendable stack {#ypn}

`payments/MintwareTreasuryVault` = matched-liquidity vault + four YPN layers: ① price-free **par-senior**
NAV (community USDC redeemable 1:1) · ② **Aave rehypothecation** of idle senior · ③ **JIT hook** seam
(truncated oracle + PnL breaker) · ④ **spendable gateway** (`burnForPayment`). It now has its own
factory/registry/deployers (multi-tenant). Card + settlement (off-chain edge-auth/relayer, CCTP Base↔Arc)
are **testnet-only, unaudited** — full picture in [`session-handoff-arc.md`](../../docs/developers/session-handoff-arc.md).

## Consolidation (branch `feat/ypn-vault-convergence`) — P0–P3 DONE

One converged lineage; only remaining gate = **external audit of the full stack before deploy.**

| Phase | What landed |
|---|---|
| **P0** | Deleted the deprecated single-sided 4626 stack + its factory (vault contracts **9 → 7**); migrated the hook test suites onto `MintwareDeFiPairVault`. |
| **P1** | Extracted `SeniorSharesMath` — one audited senior-share / virtual-offset inflation defense shared by v1 + v2. |
| **P2** | Vault self-holds its V4 position via delegatecall position lib (module deleted); JIT stays the one separate hook. Invariants re-proven (256×128k, green). |
| **P3** | Multi-tenant factory + registry for the YPN family — `onlyFactory` CREATE2 (closes front-running), two-phase ownership. |

Design/roadmap: [`vault-architecture-map.md`](../../docs/developers/vault-architecture-map.md),
[`vault-consolidation-plan.md`](../../docs/developers/vault-consolidation-plan.md), and the phase-2/3 blueprints.

## Feature flags

Real gate is **`NEXT_PUBLIC_VAULTS_LOCKED`** (`PHASE2_ENABLED` was removed — see [`deployments.md`](deployments.md)).
Semantics are **inverted**: `true` **hides** vault pages behind "coming soon"; unset/false shows them.
Contract reads gated on `NEXT_PUBLIC_SOCIAL_VAULT_ADDRESS` being set. (Canonical flag list is `AUTO`-generated
in [`../STATE.md`](../STATE.md).) The single→pair frontend ABI cutover (`lib/web3/vault/*`, `app/app/vault/*`,
`app/api/(rewards)/vault/deposit|withdraw`) is **deploy-gated** on the pair vault going live on-chain.

## Key V4 facts (avoid re-learning)

- **`BaseHook.sol` does not exist** in current v4-core/v4-periphery — implement `IHooks` directly.
- Hook address must carry the right permission bits at deploy → mine a CREATE2 salt (`lib/HookMiner.sol`).
- **afterSwap settlement gotcha:** the swapper settles its input *last*, so a hook owed the input can't
  `take()` mid-swap → take-or-mint-ERC6909-claim + keeper sweep (see `v4_afterswap_settlement_timing` memory).
- Forge: `~/.foundry/bin/forge` — `export PATH="$HOME/.foundry/bin:$PATH"`. `contracts-v4/out/` gitignored.

## Scripts

```bash
pnpm forge:build        # compile V4 contracts
pnpm forge:test         # Forge suite (invariants incl. 256×128k am-AMM + solvency)
pnpm forge:test:gas     # with gas report
pnpm test:all           # vitest + forge (Hardhat removed with the shelved campaign stack)
```
