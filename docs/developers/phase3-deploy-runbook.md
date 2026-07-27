# Phase-3 Deploy Runbook — DeFi Vault Stack (Track 0 + A)

Deploys the Phase-3 **DeFi surface** to Base Sepolia: `FeeVault → MWSocialHook (CREATE2) →
MintwareDeFiVault4626 → wiring → MintwareVaultRegistry → register`.

> **Scope:** this deploy covers the **DeFi surface only** (Tracks 0 + A). The RWA stack
> (Track B: `MintwareRWAVault4626`, `MintwareVRWA`, `SPV*Registry`, `MintwareOracleHook`,
> `PVDistributionEscrow`), the attribution mirror (Track C: `MintwareAttributionToken`), and
> the standalone `MintwareVaultFactory` are **not** in `DeployPhase3.s.sol` yet — they get
> their own deploy once the DeFi surface is validated on testnet.

## Status (verified 2026-07-27)
- ✅ All contracts compile (`pnpm forge:build`)
- ✅ Full contract suite green — **181/181** (`pnpm forge:test`)
- ✅ Deploy script present: `contracts-v4/script/DeployPhase3.s.sol`
- ⛒ Not yet deployed — needs your deployer key (below)

---

## 1. Prerequisites

Foundry on PATH: `export PATH="$HOME/.foundry/bin:$PATH"` (`cast`/`forge` live in `~/.foundry/bin`).

Set these env vars in your shell (or a **gitignored** `.env` you `source` — never commit the key):

| Var | Base Sepolia value | Notes |
|---|---|---|
| `DEPLOYER_PRIVATE_KEY` | **your key** | Funded with Base Sepolia ETH. Never commit. |
| `USDC_ADDRESS` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | Base Sepolia USDC |
| `V4_POOL_MANAGER` | `0x05E73354cFDd6745C338b50BcFDfA7E2C1b33b63` | Uniswap V4 PoolManager (Base Sepolia) |
| `ORACLE_SIGNER` | **your oracle signer address** | Signs fee/rebalance attestations |
| `TREASURY_ADDRESS` | **your treasury** | Fee recipient |
| `MINTWARE_DISTRIBUTOR` | **your distributor address** | MintwareDistributor (rewards) |
| `PYTH_ORACLE` | `0xA2aa501b19aff244D90cc15a4Cf739D2725B5729` | Optional (defaults to `0x0`) |
| `REGISTRY_ADDRESS` | *(omit on first deploy)* | Set to reuse an existing registry |
| `VAULT_NAME` / `VAULT_SYMBOL` | *(optional)* | Default: "Mintware DeFi Vault Share" / `mwDEFI` |
| `BASE_SEPOLIA_RPC_URL` | `https://sepolia.base.org` | Used by `--rpc-url base_sepolia` |
| `BASESCAN_API_KEY` | **your key** | For `--verify` on BaseScan |

Base Sepolia ETH faucet: https://www.alchemy.com/faucets/base-sepolia

---

## 2. Dry run (simulate — no broadcast)

```bash
export PATH="$HOME/.foundry/bin:$PATH"
pnpm forge:deploy:phase3:dry-run
```

This simulates the full deploy against Base Sepolia state (mines the hook CREATE2 salt for the
`0x0AC4` permission bits, runs the constructor + wiring) without sending transactions. Confirm
it prints `=== Deploy complete ===` with sensible addresses and **no reverts**.

## 3. Broadcast + verify

```bash
export PATH="$HOME/.foundry/bin:$PATH"
pnpm forge:deploy:phase3:base-sepolia
```

(Mainnet later: `pnpm forge:deploy:phase3:base`.)

Capture the logged addresses:

```
FeeVault:    0x…
Expected hook / Hook: 0x…   (ends in …0AC4 — the required V4 permission bits)
DeFiVault:   0x…
Registry:    0x…
vaultId (bytes32): 0x…
```

---

## 4. Post-deploy wiring (app + data)

1. **`.env.local` + Vercel** — point the app at the new contracts:
   ```
   NEXT_PUBLIC_SOCIAL_VAULT_ADDRESS=<DeFiVault>     # the 4626 vault
   NEXT_PUBLIC_FEE_VAULT_ADDRESS=<FeeVault>
   NEXT_PUBLIC_MW_SOCIAL_HOOK_ADDRESS=<Hook>
   NEXT_PUBLIC_VAULT_REGISTRY_ADDRESS=<Registry>
   ```
   (While here, refresh `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the Supabase dashboard — see
   [`vault_data_layer` memory] — the current one is rejected by PostgREST.)

2. **Seed the pool** — the vault owner (deployer) calls `seedTeamTokens(...)` with
   `PoolKey.hooks = <Hook>` (see the script's closing log line). This initialises the V4 pool.

3. **Supabase `social_vaults` row** — either run the create flow in the app, or adapt
   `scripts/seed-example-vault.mjs` (swap in the new `contract_address` + `surface='defi'`,
   `vault_standard='erc4626'`, `registry_address`, `registry_vault_id=<vaultId>`) so `/vaults`
   and `/vault/[id]` render it. The on-chain `positions()` panel then reads live from the new vault.

4. **Sanity check on-chain** (like we did for the Phase-2 vault):
   ```bash
   cast call <DeFiVault> "asset()(address)"        --rpc-url https://sepolia.base.org   # → USDC
   cast call <FeeVault>  "usdc()(address)"          --rpc-url https://sepolia.base.org
   cast call <Registry>  "getVault(bytes32)(...)" <vaultId> --rpc-url https://sepolia.base.org
   ```

---

## 5. Next (unblocked by this deploy)
- Build the **vault subgraph** to index `FeeVault`/`Registry`/vault events (Track D).
- Promote the `/style` two-surface pages to real routes + wire them to the registry/subgraph.
- Then the **RWA deploy** (Track B) + attribution mirror (Track C).
