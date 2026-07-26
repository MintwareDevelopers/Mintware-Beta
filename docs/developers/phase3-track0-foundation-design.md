# Phase 3 · Track 0 — Foundation Design (BaseVault4626 + Factory)

**Status:** Design → scaffolding
**Parent:** [`phase3-two-surface-architecture.md`](phase3-two-surface-architecture.md)
**Grounded in:** `contracts-v4/src/SocialVault.sol` (734 L), `FeeVault.sol` (335 L), OZ 5.6.1 `ERC4626`.

Track 0 is the critical path — both surfaces subclass this base. These decisions were made under the "I leave it to your judgement" delegation; each is documented so it can be vetoed before it hardens. **Flag any you disagree with.**

## Load-bearing decisions

### D5 — Share semantics: principal-denominated receipt (NOT live NAV)
The ERC-4626 share is a **claim on USDC principal**, and `totalAssets()` returns tracked `totalPrincipal`, *not* the live mark-to-market value of the V4 LP position.
- **Why:** LP yield already flows through the FeeVault epoch system (attribution + lock weighted, Merkle-claimed) — it is *not* meant to accrue to share price. Marking the single-sided V4 position to market on-chain is fragile (needs live tick valuation) and would double-count against FeeVault. A principal-denominated share is a clean, composable claim (usable as collateral in Aave/Morpho) — which is the whole point of going 4626.
- **Consequence:** shares stay ~1:1 with principal; they do not appreciate from swap fees. Impermanent loss on the single-sided position is borne by the LP at redemption (payout capped at realized USDC, mirroring today's `executeWithdrawal` cap). `maxWithdraw/maxRedeem` reflect lock state (see D6).

### D6 — Async lock withdrawal is the canonical redemption path
Keep today's 2-step flow (`requestWithdrawal` → 7-day notice → `executeWithdrawal`) as the base's redemption mechanism, expressed in 4626 terms: `requestRedeem(shares)` / `executeRedeem()`. Standard synchronous `withdraw()`/`redeem()` are gated — they succeed only for unlocked/Flex with no notice requirement, else revert; `maxWithdraw`/`maxRedeem` return 0 while locked so integrators see the vault is semi-liquid (honest 4626 signalling).
- **Why:** preserves the lock economics (tiers + early-exit penalty) AND gives us the exact async-redemption primitive the **RWA surface** needs (30-day settlement window). One mechanism, both surfaces — RWA just sets a longer notice + adds vRWA burn + issuer `confirmSettlement`.

### D7 — Base owns shared machinery; surfaces override liquidity
`MintwareBaseVault4626` (abstract) owns: ERC-4626 accounting (principal shares), lock tiers (`LockLib`), async withdrawal queue + penalties, epoch/FeeVault wiring, and the V4 `unlock`/`unlockCallback`/settlement plumbing. The surface hooks are `virtual`:
`_deployLiquidity(assets)` · `_removeLiquidity(liquidity)` · `_calculateDynamicFee()` · `_rebalanceIdleCapital()`.
- `MintwareDeFiVault4626` overrides `_deployLiquidity` with the current single-sided add (later: profiles/multi-pool, Track A).
- `MintwareRWAVault4626` overrides for the 40/60 reserve split + vRWA mint/burn (Track B).

### D8 — Factory deploys a per-vault {Vault, FeeVault, Hook} triple
`MintwareVaultFactory.createVault(VaultConfig)` deploys and wires one vault + its FeeVault + its hook (reproducing today's `Deploy.s.sol` topology), and records `vaultId → {vault, feeVault, hook, vRWA, surface}` on-chain (this becomes the multi-tenant registry; Supabase indexes it instead of being it).
- FeeVault stays **one-per-vault** for v1 (matches current wiring; a shared multi-vault FeeVault is a later optimization).
- `upgradeVaultImplementation(newImpl)` affects **future** vaults only — deployed vaults are immutable (no UUPS on live funds). Safer and simpler than proxy-upgrading live positions.

### D9 — One V4 pool per vault for v1
The base assumes a single pool (as today). The spec's `targetPools[]` multi-pool deployment is a DeFi-surface extension deferred to Track A.

## VaultConfig (Track 0 shape)
```solidity
enum VaultSurface { DeFi, RWA }
struct VaultConfig {
    VaultSurface surface;
    address provider;          // strategy manager (DeFi) / issuer (RWA)
    address underlyingToken;   // USDC for v1
    string  name;              // ERC20 share name
    string  symbol;            // ERC20 share symbol
    uint256 minDeposit;
    uint256 entryFeeBps;       // 0 for v1 unless enabled (see Track A fee decision)
    uint256 exitFeeBps;
    bool    enableMEVProtection;
    bool    enableIdleCapital;
    uint256 idleTargetRatio;   // e.g. 60e18
}
```

## Migration / redeploy
The current `SocialVault` on Base Sepolia is replaced by a fresh factory-produced `DeFiVault4626` deploy (clean redeploy, not an upgrade — the storage layout changes fundamentally with ERC-4626). Supabase `social_vaults`/`vault_epochs` get a migration to reference factory `vaultId`s. No mainnet vault funds exist yet, so redeploy is low-risk.

## Build order within Track 0
1. ✅ `VaultTypes.sol` (config + enums + record)
2. ✅ `MintwareBaseVault4626.sol` (abstract) — V4 plumbing + lock/withdrawal + 4626 wiring (compiles)
3. ✅ `MintwareDeFiVault4626.sol` (concrete) — single-sided `_deployLiquidity`/`_removeLiquidity`/`_rebalanceLiquidity` + team-seed/pool-init
4. ✅ `MintwareVaultRegistry.sol` — on-chain registry (see D8 revision below)
5. ✅ Forge tests: 6 DeFiVault integration tests vs real V4 `PoolManager` + 5 registry tests — **11/11 pass**
6. ⏳ Fresh Base Sepolia deploy script + Supabase migration (next)

### D8 revision (2026-07-26) — factory → registry for v1
A `new`-based `createVault` factory compiled to **38.9 KB runtime**, over the 24 KB EIP-170 limit (it embeds the 22 KB `MintwareDeFiVault4626` creation code). The clean fix — minimal-proxy **clones + an initializer** — requires refactoring the base off constructor-`immutable`s onto an initializer and vendoring `openzeppelin-contracts-upgradeable` (not currently in `contracts-v4/lib`). For Track 0 the on-chain artifact is therefore **`MintwareVaultRegistry`** (deploy + wire via the deploy script, register on-chain = the multi-tenant source of truth). Full on-chain `createVault` is tracked into Track A alongside the clones/initializer refactor.

### Test note
Pre-existing `Integration.t.sol` (11) and `FeeVault.t.sol` (1) failures were confirmed present at the pre-Track-0 commit `10ee1148` — not introduced by this work.
