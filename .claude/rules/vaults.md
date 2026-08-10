# Vaults — Two-Surface Architecture (Phase 3)

> ⚠ **RECONCILE BANNER (2026-08-08 contract audit — read before trusting the tables below):**
> - **RWA is SHELVED** — the "two-surface (DeFi + RWA)" framing is aspirational, not live. Ignore RWA references here.
> - **Contract names below are STALE.** `SocialVault.sol` / `MWSocialHook.sol` / `LockLib` / `FeeLib` **no longer exist**. The canonical DeFi hook is **`MWHookCoordinator.sol`** (+ `MWDynamicFee`/`MWOracleGuard`); vaults are on the `MintwareBaseVault4626` / `MintwareVaultFactory` stack.
> - **Two contract tiers exist.** The *newest* contracts are genuinely state-of-the-art — **`MintwareWeightedDistributor`** (on-chain sig-verified epoch close; the correct fix for FeeVault's dead-attestation C1), **`MintwareMatchedLiquidityVault`** (two-sided, invariant-fuzzed), **`MintwareDeFiPairVault`** (correct dual-sided). But `DeployPhase3.s.sol` ships the *weaker* stack (**single-sided `MintwareDeFiVault4626` + legacy `FeeVault`**), and that 4626 vault has a **known NAV/solvency flaw** (principal-pegged shares vs 2-token LP backing → late-redeemer loss). **Do NOT put real value on the DeployPhase3 stack.** The good stack + `MintwareVaultFactory` are built/tested but **unwired** — wiring them + deleting the dead layer (`FeeLib`/`LockLib`/`IPyth`, dead FeeVault attestation) is pending, then external audit.
> - The working vault reward loop is **Rail B** (`MintwareWeightedDistributor` + `cron/vault-weighted-epoch-close` + `vault/weighted-claim`); deploy script `contracts-v4/script/DeployWeightedDistributor.s.sol` (2026-08-08, PR #73).
> - **RETIREMENT (2026-08-09):** the single-sided `MintwareDeFiVault4626` (+ base) now carries an in-code DEPRECATION NatSpec pointing to `MintwareDeFiPairVault`; `DeployPhase3.s.sol` is banner-deprecated in favour of `DeployPairVault.s.sol`; the registry gained `deactivateVault`/`active` to retire on-chain instances. The remaining **frontend Phase-3B cutover** (single→pair ABI across `lib/web3/vault/*`, `app/(rewards)/vault/*`, `app/api/(rewards)/vault/deposit|withdraw`) is **deploy-gated** on the pair vault going live on-chain and is tracked as its own task (untestable until then).

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
