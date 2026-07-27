# Mintware Vault Subgraph (Phase 3)

Indexes the on-chain vault stack on **Base Sepolia (84532)** so the app can read vault
discovery, TVL, positions, and fee epochs without RPC fan-out.

## Indexed contracts (deployed 2026-07-27, startBlock 44706790)
| Contract | Address | Role |
|---|---|---|
| MintwareVaultRegistry | `0x35067e7603ee971d03c81471d25ae181ac79a972` | vault discovery → spawns a template per vault |
| FeeVault | `0x53dd1b7ea00cf8ae9152fd139a2c6ad67826941c` | epoch lifecycle + fee receipts |
| MintwareVault (template) | *(per registered vault)* | ERC-4626 Deposit/Withdraw + LockRecorded |

First registered vault (via template): DeFiVault `0x8dd409b81e6ec30475055983c5a3d7d2768697a3`.

## Entities
`Vault` (keyed by vault address) · `Position` (per user/vault) · `Deposit` / `Withdraw`
(immutable event logs) · `FeeEpoch` / `FeeReceipt`. `VaultLookup` maps registry vaultId → address.

## Build & deploy
```bash
cd subgraph/vault
pnpm install            # graph-cli + graph-ts
pnpm codegen            # generate types from ABIs + schema
pnpm build              # compile mappings to wasm
# Deploy to Subgraph Studio (create "mintware-vaults" in the Studio first, set the deploy key):
graph auth <STUDIO_DEPLOY_KEY>
pnpm deploy:studio
```

`network: base-sepolia` is set in `subgraph.yaml`; confirm Studio supports Base Sepolia (it
does). Addresses + startBlock are baked into the manifest — update them if you redeploy the
contracts.

## Wiring the app to it
Once synced, the Studio gives a query URL. Add it as `NEXT_PUBLIC_VAULT_SUBGRAPH_URL` and swap
the mock `getVaultsDiscovery()` / `getVault()` seams in `lib/vaults/discovery.ts` (and the live
`/api/vaults` reads) to query it instead of the Supabase mirror. TVL/positions/epochs then come
straight from chain-indexed data.
