# Phase-3 DeFi Vault — Go-Live Runbook

The converged DeFi vault stack (`MintwareDeFiVault4626` + `MWHookCoordinator` + `FeeVault`)
is built, tested, and merged, but **not deployed anywhere** — the only live contracts are the
retired Phase-2 `SocialVault`/`MWSocialHook` on Base Sepolia. This is the turnkey path to ship it.

The deploy **sequence is proven** by `contracts-v4/test/DeployPhase3.t.sol` (replicates the
script 1:1, then runs deposit → swap → collectFees → async-redeem end-to-end). Run it before you
touch a real key:

```bash
pnpm forge:test --match-contract DeployPhase3Test
```

---

## 0. Preconditions

- **CREATE2 factory** `0x4e59b44847b379578588920cA78FbF26c0B4956C` must exist on the target chain
  (it does on Base + Base Sepolia). `DeployPhase3` mines the hook address for this factory and
  relies on Foundry routing salted `new` through it during `--broadcast`. If it's missing, the
  `require(address(hook) == expectedHook)` reverts — deploy the factory first.
- **Uniswap V4 `PoolManager`** deployed on the chain (addresses below).
- **Oracle signer** keypair: the EOA whose private key signs `RangeProposal` EIP-712 messages
  (`ORACLE_PRIVATE_KEY`, server-only / 1Password — never commit). Its address is `ORACLE_SIGNER`.
- Rate limiting is currently **inactive** (Upstash env unset). Set `UPSTASH_REDIS_REST_URL`/`_TOKEN`
  before meaningful TVL (see `.claude/rules/security.md`).

| Chain | `V4_POOL_MANAGER` | `USDC_ADDRESS` |
|---|---|---|
| Base Sepolia (84532) | `0x05E73354cFDd6745C338b50BcFDfA7E2C1b33b63` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Base Mainnet (8453) | `0x498581fF9918ee3e5f1fc97e9fa62afc18901efa` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

---

## 1. Deploy (testnet first)

Env for the script (`contracts-v4/script/DeployPhase3.s.sol`):

```bash
export DEPLOYER_PRIVATE_KEY=0x...        # deployer EOA (becomes vault/hook owner + provider)
export V4_POOL_MANAGER=0x05E7...         # from the table above
export USDC_ADDRESS=0x036C...
export ORACLE_SIGNER=0x...               # address of the rebalance oracle key
export TREASURY_ADDRESS=0x...            # Mintware fee recipient
export MINTWARE_DISTRIBUTOR=0x...        # MintwareDistributor (for FeeVault epoch claims)
# optional: REGISTRY_ADDRESS (reuse an existing registry), VAULT_NAME, VAULT_SYMBOL

forge script contracts-v4/script/DeployPhase3.s.sol \
  --rpc-url base_sepolia --broadcast --verify -vvvv
```

Capture from the logs: **FeeVault**, **DeFiVault**, **Hook (coordinator)**, **Registry**, **vaultId**.

The script wires everything: `hook.setVault(vault)`, `feeVault.setSocialVault(vault)`,
`feeVault.setHook(hook)`, `registry.registerVault(...)`. It does **not** configure a pool,
seed liquidity, or set the vault oracle — steps 2–4.

## 2. Post-deploy on-chain config (owner = deployer)

1. **Coordinator pool config** — enables the dynamic fee + oracle guard for the pool:
   `hook.configurePool(poolId, baseFeePips, maxFeePips, slopePipsPerTick, maxFeeStepPerBlock,
   dynamicFeeEnabled, guardEnabled, maxTickMovePerBlock, maxDeviationTicks, maxCatchupBlocks)`.
   (Start with the guard on + a wide `maxDeviationTicks`; enable dynamic fee only on a
   dynamic-fee-flagged pool.)
2. **Seed the pool** — `vault.seedTeamTokens(vaultId, projectToken, amount, poolKey, sqrtPriceX96)`
   with `poolKey.hooks = <coordinator>`. This initializes the V4 pool.
3. **Vault oracle signer** — `vault.setOracleSigner(<ORACLE_SIGNER>)` so `rebalanceWithProposal`
   accepts oracle-signed range proposals. **The signing domain is `EIP712("MintwareVault","1")`** —
   the frontend (`lib/web3/vault/rangeProposer.ts`) already matches this; do not change it.
4. **Guardian (Stage-1.4 kill-switch)** — `vault.setGuardian(<monitoring addr>)` and
   `hook.setGuardian(<monitoring addr>)`. Until set, only the owner can pause.

## 3. Wire off-chain

- **Vercel env**: `NEXT_PUBLIC_SOCIAL_VAULT_ADDRESS = <DeFiVault>` (still the env name post-repoint —
  see PR #43), `NEXT_PUBLIC_USDC_ADDRESS`, `NEXT_PUBLIC_PHASE2_ENABLED` (leave OFF for now),
  `ORACLE_PRIVATE_KEY` (server, rebalance signing).
- **Supabase**: insert the `social_vaults` row with `contract_address = <DeFiVault>` (the app reads
  `vault.contract_address` first, env as fallback).

## 4. Verify, then flip the flag

- Confirm wiring on-chain (mirror `DeployPhase3Test.test_deploy_wiring_is_correct`): `hook.vault()`,
  `vault.feeVault()`, `feeVault.socialVault()`, `feeVault.hook()` all cross-point correctly.
- Do a small real deposit → swap → `collectFees()` → `requestRedeem`/`executeRedeem` on testnet.
- Source-verify all contracts on Basescan (also a Stage-2.1 discoverability signal).
- Set `NEXT_PUBLIC_PHASE2_ENABLED=true` to expose the vault pages.

## 5. Mainnet

Repeat 1–4 with the Base Mainnet addresses. Rotate/segregate the oracle key. Do **not** enable
the flag on mainnet until testnet has run a full lifecycle and the guardian + monitoring are live.

---

## Known gaps / notes

- **Factory does not produce the new pair vaults.** `MintwareVaultFactory.createVault` fits
  `MintwareDeFiVault4626` (ERC-4626: `asset`/`provider`/`treasury`/`setFeeVault`) but **not**
  `MintwareDeFiPairVault`/`MintwareMatchedLiquidityVault` (not ERC-4626, on-chain fees, different
  constructor). A `createPairVault` path is future work; the single-sided 4626 vault is the app
  target today, so this does not block go-live.
- **`FeeVault.setSocialVault` naming** is a misnomer post-retirement (it means "the authorized
  vault"). Functional; rename is cosmetic follow-up.
- **Frontend `Social*` naming** (`socialVaultAbi.ts`, `NEXT_PUBLIC_SOCIAL_VAULT_ADDRESS`) is
  likewise a post-repoint misnomer — functional, cosmetic to rename (PR #43).
- **Withdraw completion**: the app wires `requestRedeem` (queue) but not yet `executeRedeem` or
  the D6 instant `redeem()` for Flex — a withdraw-completion UI action is a follow-up.
