# Vaults — Two-Surface Architecture (Phase 3)

> **⤴ Direction (2026-07-26): Phase 3 evolves these Phase-2 Social Vaults into a two-surface
> (DeFi + RWA) system on a shared ERC-4626 base + factory.** Target architecture, tracks, and
> sequencing live in [`docs/developers/phase3-two-surface-architecture.md`](../../docs/developers/phase3-two-surface-architecture.md).
> Everything below the line is the **current (Phase 2) state that Phase 3 builds on** — it is
> still accurate for what's deployed today. As each Phase-3 track merges, its contract/API
> reference is added here; we do **not** document unbuilt contracts ahead of time.
>
> **Phase 3 locked decisions:** both surfaces in parallel · keep off-chain attribution + add a
> thin on-chain soulbound mirror · commit to ERC-4626 base + multi-tenant factory · evolve, don't
> greenfield. **Phase-3 branch:** `feature/phase-3`.
>
> **RWA flow — wrap→list→trade COMPLETE (2026-08-01, PR #29).** `MintwareRWAVault4626.listAndSeedPool()`
> lists the vRWA on an oracle-banded vRWA/USDC V4 pool (`MintwareOracleHook`, dynamic fee) + seeds
> two-sided liquidity (reserve model: seed-aware `_deployLiquidity`; deposits/redemptions never touch the
> market). Full path proven in `MintwareRWAFlow.t.sol` (wrap→list→trade via `MWRouter` + out-of-band revert).
> Turnkey `DeployRwaFlow.s.sol`; `/api/admin/vaults/rwa/[id]/list` records the deploy + seeds `router_pools`;
> the RWA deposit UI activates on `vault_address`. Remaining is per-deal deploy + KYC/legal only.
>
> **⚠ Compliance restructure (2026-08-05) — target model changed, NOT yet built.** Legal/compliance
> set the RWA secondary-liquidity structure to a **three-role model**: LPs are USDC-only and ungated
> (never touch vRWA), the pool is a whitelisted *permitted holder* of issuer-supplied vRWA inventory,
> and traders are KYC-checked in `beforeSwap` **on receipt only** (vRWA-out leg). This supersedes the
> current "permissionless everything, KYC only at redemption" code as the **target** for Reg D assets
> (Reg A+ runs fully open). The current code diverges on 3 points (deposit mints vRWA to the depositor;
> `beforeSwap` gates nothing; pool not enrolled as permitted holder). One open blocker for counsel:
> whether the LP side needs a 3(c)(7) qualified-purchaser gate (Investment Company Act, per Ondo OUSG).
> Decision of record + gap analysis: [`docs/developers/rwa-compliance-three-role-model.md`](../../docs/developers/rwa-compliance-three-role-model.md).

---

# Current state — Phase 2 (Social Liquidity Vaults)

## Status: T1.1 complete (2026-03-23)

Branch strategy:
- `main` — Phase 1, always deployable
- `feature/phase-2` — integration branch (nothing to main until Phase 2 ships)
- `feature/p2-contracts` — V4 contracts (commit `7034f40`)
- `feature/p2-schema`, `feature/p2-frontend` — created, not started

## Contracts (Foundry — `contracts-v4/`)

| File | Purpose |
|---|---|
| `contracts-v4/src/MWSocialHook.sol` | Uniswap V4 hook — vault-only LP, dynamic fee, MEV capture |
| `contracts-v4/src/SocialVault.sol` | LP position manager — deposits, lock tiers, withdrawal queue |
| `contracts-v4/src/FeeVault.sol` | Fee accumulation + epoch distribution + 90-day soft expiry |
| `contracts-v4/src/lib/LockLib.sol` | Lock tier math + early exit penalty |
| `contracts-v4/src/lib/FeeLib.sol` | Attribution-weighted fee share math |
| `contracts-v4/test/SocialVault.t.sol` | Forge tests — stubbed |
| `contracts-v4/test/FeeVault.t.sol` | Forge tests — stubbed |
| `contracts-v4/script/Deploy.s.sol` | Deploy script — implement at T1.6 |
| `foundry.toml` | Foundry config at project root |

## Key V4 Facts (avoid re-learning)

- **`BaseHook.sol` does not exist** in current v4-core/v4-periphery. Implement `IHooks` directly.
- Hook address must have correct permission bits at deploy. Use `HookMiner.find()` (CREATE2 salt mining). Required for T1.4.
- `contracts-v4/out/` is gitignored.
- Forge: `~/.foundry/bin/forge` — add to PATH: `export PATH="$HOME/.foundry/bin:$PATH"`

## Pending T1.2 Work

- Fix `FeeVault.socialVault` circular dep (immutable → owner-settable)
- Implement Pyth MEV capture in `afterSwap`

## Feature Flags

All vault pages gated on `NEXT_PUBLIC_PHASE2_ENABLED`:
- `/vaults`, `/vault/[id]`, `/vault/create` → redirect to `/` if not set
- All Phase 2 contract reads gated on `NEXT_PUBLIC_SOCIAL_VAULT_ADDRESS` being set

## Scripts

```bash
pnpm forge:build        # compile V4 contracts
pnpm forge:test         # Forge test suite
pnpm forge:test:gas     # with gas report
pnpm test:all           # vitest + hardhat + forge
```

## Products

- **Attribution** (live) — on-chain reputation scoring, 100+ chains
- **Mintware** (coming soon) — social LP vaults + reward pools weighted by Attribution score
