# Threshold Seeding — Deploy Runbook

**Contracts:** `MintwareSeedPool.sol` (singleton) + `MintwareSeedAdapter.sol` (one per vault).
**Tests:** Forge 14/14 (`MintwareSeedPool.t.sol` + `SeedPoolIntegration.t.sol` — real V4 PoolManager).
**Design:** [phase3-rwa-create-seed-design.md §2](phase3-rwa-create-seed-design.md) · spec in [vaults-rwa-build-spec.md](vaults-rwa-build-spec.md).

> ⚠️ **AUDIT GATE.** These contracts escrow user funds. Do **not** deploy to mainnet before an audit.
> Base Sepolia (testnet) first, exercise the full flow, then mainnet after audit sign-off.

---

## Prerequisites

- Foundry on PATH: `export PATH="$HOME/.foundry/bin:$PATH"`
- `DEPLOYER_PRIVATE_KEY` in the environment (the wallet that will own the target vault — needed to
  transfer ownership to the adapter).
- A deployed `MintwareDeFiVault4626` + its `MWSocialHook` (from the Phase-3 deploy —
  see [phase3-deploy-runbook.md](phase3-deploy-runbook.md)). You'll need the vault address, the pool
  pair currencies, fee/tickSpacing, and the hook address.

### Reference addresses
| | Base Sepolia (84532) | Base Mainnet (8453) |
|---|---|---|
| V4 PoolManager | `0x05E73354cFDd6745C338b50BcFDfA7E2C1b33b63` | `0x498581ff9918ee3e5f1fc97e9fa62afc18901efa` |
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

---

## Step 1 — Deploy the SeedPool singleton (once per chain)

```bash
DEPLOYER_PRIVATE_KEY=0x… pnpm forge:deploy:seedpool:base-sepolia
```

Dry-run first (no broadcast): `pnpm forge:deploy:seedpool:dry-run`.
Record the printed address as **`NEXT_PUBLIC_SEED_POOL_ADDRESS`** (Vercel + `.env.local`).

---

## Step 2 — Deploy a per-vault adapter (per vault you want to fair-launch)

The adapter is deployed **once per vault** and is set as the vault's owner so it can seed the reserve
and set the LP range. Set these env vars, then run:

```bash
export DEPLOYER_PRIVATE_KEY=0x…       # must be the vault's CURRENT owner
export VAULT_ADDRESS=0x…              # the MintwareDeFiVault4626
export SEED_POOL_ADDRESS=0x…          # from Step 1
export VAULT_ID=0x…                   # bytes32 (keccak of your vault key); the seed's poolInit
export POOL_CURRENCY0=0x…             # sorted pair (asset() + project token)
export POOL_CURRENCY1=0x…
export POOL_FEE=3000                  # uint24
export POOL_TICK_SPACING=60           # int24
export POOL_HOOKS=0x…                 # the MWSocialHook address
export TICK_LOWER=-60000              # LP range (int24) — NOT full-range (0 liquidity for 6-dp)
export TICK_UPPER=60000

pnpm forge:deploy:seedadapter:base-sepolia
```

This deploys the adapter **and** calls `vault.transferOwnership(adapter)`. After this, only the
adapter drives the vault's owner-only seed/rebalance — which is exactly what the raise needs.

> **Note:** ownership transfer is one-way (OZ `Ownable`). The deployer must be the vault's current
> owner. Once transferred, admin actions on that vault flow through the adapter (or a later
> ownership move).

---

## Step 3 — Open the raise on the SeedPool

Called by the **team wallet** (escrows the reserve + optional quote). Approve the SeedPool for the
project token (and any team quote) first, then call `openSeed`:

```
openSeed(seedId, OpenParams{
  projectToken, quoteToken,
  target:               <adapter address from Step 2>,
  tokenReserve,         // full project-token side (escrowed now)
  teamQuote,            // optional pre-funded quote
  publicQuoteTarget,    // quote left for the public
  deployThresholdBps,   // e.g. 5000 = 50%
  raiseDeadline,        // unix ts
  sqrtPriceX96,         // pool init price
  poolInit:             <VAULT_ID>,   // MUST equal the adapter's vaultId
  fullReserveOnFinalize: true         // required for vault-backed adapters
})
```

Record `seedId` + the SeedPool/adapter addresses in the `vault_seeding` row (`POST /api/vaults/seed`)
so the `SeedPanel` renders the raise.

---

## Lifecycle (after opening)

| Call | Who | Effect |
|---|---|---|
| `contributeQuote(seedId, amount)` | public | Adds quote (clamped at target) |
| `finalizeSeed(seedId)` | anyone, once threshold met | Adapter seeds vault + inits V4 pool + sets range + deposits raised quote → LP live |
| `growLiquidity(seedId)` | anyone, while Live | Deposits newly-raised quote as more liquidity |
| `closeSeed(seedId)` | team | Deploys pending quote, returns undeployed reserve |
| `markRefunding` → `claimRefund` / `teamReclaim` | anyone / contributors / team | Deadline missed below threshold → everyone reclaims |

---

## Post-deploy verification (cast)

```bash
# SeedPool state after finalize
cast call $SEED_POOL_ADDRESS "getState(bytes32)(uint8,uint256,uint256,uint256,uint256)" $VAULT_ID --rpc-url base_sepolia
# adapter holds the LP shares
cast call $ADAPTER "totalShares()(uint256)" --rpc-url base_sepolia
cast call $ADAPTER "seeded()(bool)" --rpc-url base_sepolia
# vault liquidity is live
cast call $VAULT_ADDRESS "totalLiquidity()(uint128)" --rpc-url base_sepolia
```

---

## Remaining wiring (after a successful testnet run)

- **UI:** wire the `SeedPanel` "Seed this vault" button to the on-chain `contributeQuote`
  (currently informational until `contract_address` is set on the `vault_seeding` row).
- **Per-contributor shares:** LP shares accrue to the adapter in aggregate; add a distribution
  layer so contributors claim their pro-rata share (tracked in `seed_contributions`).
- **Progress sync:** a small indexer/cron to mirror on-chain `quote_raised` / `phase` into
  `vault_seeding` for the panel.
