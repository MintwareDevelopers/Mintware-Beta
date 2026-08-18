# Smart Contracts

> **⛔ CAMPAIGNS SHELVED (2026-08-12):** the `MintwareDistributor` campaign distributor and its
> **entire Hardhat toolchain** (`contracts/`, `scripts/deploy*`, `hardhat.config.cts`,
> `tsconfig.hardhat.json`, the `hardhat:*` npm scripts) were **removed from the repo** — preserved on
> branch `archive/campaigns-surface`. **Ignore every `MintwareDistributor` / Hardhat section below —
> it is historical.** Live contract work is **Forge**: vaults in `contracts-v4/`, AIAttribution v3 in
> `contracts-ai/` (still live on Base). Run contract tests with `pnpm forge:test` (no more `hardhat:*`).

---

# Live Forge stack (current — read this, not the historical sections)

> **Dated note (2026-08-18, branch `feat/ypn-vault-convergence`, not on `main`).** This is the
> **contract-level "one home"** — the inventory of what is actually built now in `contracts-v4/`
> (+ AIAttribution in `contracts-ai/`). Product-level detail lives in its own homes:
> DeFi/ULV vaults → [`vaults.md`](vaults.md); YPN treasury / card / settlement + off-chain services →
> [`payments-ypn.md`](payments-ypn.md); env + testnet deploy scripts → [`deployments.md`](deployments.md).
> **Everything below the next `---` — the Phase-3 "two-surface" banner, `MintwareDistributor` v2, the
> Hardhat/ESM notes — is HISTORICAL** (campaigns + RWA shelved; Hardhat removed).
>
> **Honesty:** all vault/settlement/MEV work is **testnet + unaudited**; the *only* mainnet contract is
> **AIAttribution v3** (Base). External audit gates real value everywhere else. `pnpm forge:test` =
> **463 / 0 / 4 skipped** (fork tests self-skip without an RPC). No Hardhat.

## Where things live

| Dir | Contents |
|---|---|
| `contracts-v4/src/vaults/` | DeFi LP vault universe (pair vaults, registry, adapters, v3→v4 migrator, distributor) |
| `contracts-v4/src/payments/` | YPN treasury / spendable stack + ETH settlement + CCTP + multi-tenant factory |
| `contracts-v4/src/hooks/` | Uniswap-V4 hooks + MEV engine (am-AMM, dynamic/surge fee, oracle guard) |
| `contracts-v4/src/lib/` | Shared libs — `SeniorSharesMath`, `MWGuardianPausable`, `MWTimelockedOracleSigner`, `HookMiner` |
| `contracts-ai/src/` | `AIAttribution.sol` (v3) — the one mainnet contract |

## DeFi LP vault universe (`src/vaults/`) — consolidated (P0–P3 done)

| Contract | Role / status |
|---|---|
| `MintwarePairVault` | Abstract **dual-sided base** (every vault is dual-sided). `MWGuardianPausable` + `ReentrancyGuard`. |
| `MintwareDeFiPairVault` | **Canonical** dual-sided DeFi pair vault (go-forward). `depositFor(recipient,…)` for the migrator. Largest contract — watch EIP-170. |
| `MintwareMatchedLiquidityVault` | Team-locked / community-matched launch vault, ≥90d cliff. Invariant-fuzzed. Also on `MintwarePairVault` — a deliberate second product, not a dup. |
| `MintwareVaultRegistry` | Multi-tenant registry — `deactivateVault`/`active` to retire on-chain instances. |
| `AaveV3YieldAdapter` | Idle-capital adapter (Aave v3 rehypothecation) behind the ULV engine. |
| `MintwareERC4626YieldAdapter` | **Fee-aware** ERC-4626 adapter (Arc yield seam): `totalAssets`/`maxWithdrawable` via `previewRedeem`, exit via `redeem` (handles non-standard 4626 exit fees, e.g. XyloVault). |
| `Mintwarev3ToV4Migrator` | One-tx migrate a dormant Uniswap-v3 LP → v4 pair vault, mint shares to user (+ fork test). |
| `MintwareWeightedDistributor` | **Reward Rail B** — on-chain sig-verified epoch close; pairs with `cron/vault-weighted-epoch-close` + `vault/weighted-claim`. Invariant-tested. |

**Deleted in P0 consolidation:** single-sided `MintwareBaseVault4626` + `MintwareDeFiVault4626` (known
NAV/solvency flaw) and the old DeFi 4626 factory; `MintwareV4LiquidityModule` folded into the vault via
delegatecall (`payments/lib/MWTreasuryPositionLib`). Do not reference them — gone from `src`.

## YPN spend stack (`src/payments/`) — treasury → spendable USDC

| Contract | Role |
|---|---|
| `MintwareTreasuryVault` | **YPN v2** — senior/junior tranche, price-free senior NAV, spendable. Self-holds its V4 position via delegatecall `lib/MWTreasuryPositionLib`. |
| `MintwareYieldVault` | v1 flat-senior USDC vault (the live Arc-testnet vault instance). |
| `MintwareTreasuryJitHook` | Standalone V4 JIT hook — borrow-idle → JIT → settle atomic; junior backstops; senior NAV untouched. |
| `MintwarePaymentGateway` | Card rail — `settleSpend` / `burnForPayment` (EIP-712 permit → burn shares → pay merchant). |
| `MintwareEthSettlement` | Multi-collateral — oracle-bounded batch **ETH → USDC** settlement swap. |
| `MintwareCctpDepositRouter` | CCTP `receiveAndDeposit` — bridged USDC lands as yield-earning shares. |
| `MintwareTreasuryVaultFactory` + `…Registry` + `MintwareTreasuryDeployers` | **P3 multi-tenant** deploy/track for YPN vaults (CREATE2, onlyFactory, two-phase ownership). |
| `IYieldVault` / `lib/SeniorSharesMath` | Shared YPN interface + extracted senior-share/virtual-offset math (P1 — one audited inflation defense). |

## V4 hooks + MEV engine (`src/hooks/`) — PR #261 complete

`MWHookCoordinator` (canonical hook) + `MWDynamicFee` + `MWOracleGuard` + `MWAmAuction`/`MWAmAuctionLib`.
Levers: **dynamic / surge / quadratic fee**, **MEV-tax** (Base-only; a bonus, never counted as solvency),
**am-AMM** (rent + hook enrollment). **All levers OFF/inert by default; oracle-free.** Invariants **7/7**
green (256×128k). `MWHookCoordinator._rebalanceIdleCapital` / `_calculateDynamicFee` are dead no-ops.

## Deployments (honest)

| Network (chain) | Contract | Address | Status |
|---|---|---|---|
| **Base mainnet (8453)** | `AIAttribution` v3 | `0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421` | ✅ **Live** — only mainnet contract (`AI_ATTRIBUTION_CHAIN_ID=8453`) |
| Base Sepolia (84532) | ULV vault | `0x6c0d…5132` | ⚠ testnet, unaudited, empty |
| Base Sepolia (84532) | ULV hook | `0x9f3c…0AC8` | ⚠ testnet |
| Base Sepolia (84532) | ETH-collateral vault | `0x09Cda8519737a60FD16D263f94fb56237CDb7E42` | ⚠ testnet |
| Base Sepolia (84532) | `MintwareEthSettlement` | `0x20140811123db9C00CA1dF1023BA4fE758B98c5F` | ⚠ testnet |
| Arc testnet (5042002) | Vault (`MintwareYieldVault`) | `0x11Ef…C421` | ⚠ testnet (YPN spend stack) |
| Arc testnet (5042002) | `MintwarePaymentGateway` | `0x1D07…5399` | ⚠ testnet |
| Arc testnet (5042002) | `MintwareERC4626YieldAdapter` | `0xb9FB…2B88` | ⚠ testnet |
| Arc testnet (5042002) | CCTP deposit router | `0xDB9D…Fc03` | ⚠ testnet |

> The Arc vault/adapter addresses coincidentally string-match the Base AIAttribution v3 / deprecated-v2
> addresses (same deployer nonce, different chains) — they are **unrelated contracts**. Full deploy record +
> on-chain proofs: [`../../docs/developers/session-handoff-arc.md`](../../docs/developers/session-handoff-arc.md).

## Run

```bash
export PATH="$HOME/.foundry/bin:$PATH"
pnpm forge:test          # 463 / 0 / 4 skipped
pnpm forge:build         # compile
pnpm forge:test:gas      # with gas report
```

---

> **⤴ Phase 3 (Two-Surface Vaults)** adds a new contract family — `MintwareBaseVault4626`,
> `MintwareVaultFactory`, `MintwareDeFiVault4626` / `MintwareRWAVault4626`, `MintwareVRWA`,
> `MintwareOracleHook`, SPV/KYC registries, and a soulbound `MintwareAttributionToken`.
> Target design + sequencing: [`docs/developers/phase3-two-surface-architecture.md`](../../docs/developers/phase3-two-surface-architecture.md).
> The contracts below are the **current** deployed set; Phase-3 contracts are documented here as they merge.

## MintwareDistributor v2 — multi-chain via env (⚠ NOT confirmed on Base mainnet)

> ⚠ **Deployment reality (2026-08-08 audit):** there is **no deployment record for
> MintwareDistributor on Base mainnet**. The address is resolved purely from env per
> chain (`lib/rewards/creator.ts`) — configured for Arbitrum + Base Sepolia. The
> "Base Mainnet" heading below was aspirational. Everything on testnet per the current
> direction; treat mainnet as not-yet-deployed until a broadcast record exists.

Contract files:
- `contracts/MintwareDistributor.sol` — v2.0.0
- `contracts/MockERC20.sol` — test-only
- `contracts/test/MintwareDistributor.test.cjs` — 72/72 passing
- `hardhat.config.cts` — `.cts` required (CJS, `"type":"module"` in package.json)
- `tsconfig.hardhat.json` — separate TS config (module: commonjs)
- `scripts/deploy.cjs` — deploy + auto-verify

## v2 Breaking Changes

| # | Change |
|---|---|
| 1 | `ORACLE_SIGNER` (immutable) → `oracleSigner` (mutable, timelocked). New: `proposeOracleSigner`, `confirmOracleSigner`, `cancelOracleRotation` |
| 2 | `ROOT_TYPEHASH` includes `uint256 deadline`. `claim()` and `batchClaim()` take `deadline` param |
| 3 | `campaignToken[id]` → `campaigns[id].token`. New view: `getCampaign(campaignId)` |
| 4 | Events have `bytes32 indexed campaignIdHash`. Indexers filter on `keccak256(bytes(campaignId))` |
| 5 | `depositCampaign` uses balance-diff accounting (safe for fee-on-transfer tokens) |
| 6 | New functions: `batchClaim()`, `closeCampaign()`, `withdrawCampaign()`, `emergencyWithdraw()`, `getCampaign()` |
| 7 | `ReentrancyGuard` added — `nonReentrant` on all state-changing functions |

## Oracle Rotation (48h Timelock)

```
proposeOracleSigner(newAddr)   ← onlyOwner
  ↓  (wait 48 hours)
confirmOracleSigner()          ← onlyOwner
  OR
cancelOracleRotation()         ← onlyOwner
```

Admin endpoint: `GET /api/admin/oracle/rotation` — reads rotation state via raw `eth_call`

## Campaign Lifecycle (v2)

```
depositCampaign()   ← anyone; first depositor = creator
  ↓
closeCampaign()     ← onlyOwner
  ↓  (7-day WITHDRAWAL_COOLDOWN)
withdrawCampaign()  ← campaign creator — recovers remaining balance
```

Emergency: `pause()` → `emergencyWithdraw()`

## Leaf Encoding (CRITICAL — unchanged in v2)

Both sides must produce identical hashes:
- **Solidity**: `keccak256(bytes.concat(keccak256(abi.encode(address, uint256))))`
- **TypeScript**: `StandardMerkleTree.of([[wallet, amount]], ['address', 'uint256'])`

Uses `abi.encode` (64-byte padded), **NOT** `abi.encodePacked` (52 bytes). Mismatch causes all claims to revert.

## Deploy Targets

```bash
pnpm hardhat:deploy:base-sepolia   # Base Sepolia (84532)
pnpm hardhat:deploy:base           # Base mainnet (8453)
pnpm hardhat:deploy:bnb            # BNB Chain (56)
```

After deploy: set `NEXT_PUBLIC_MW_TREASURY_ADDRESS` in `.env.local` and update `campaigns.contract_address` in Supabase.

## AIAttribution v3 — Base Mainnet

- Address: `0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421`
- v2 (`0xb9FB965...`) deprecated — `setOracle` ABI removed
- Chain ID: 8453 (Base mainnet) — set via `AI_ATTRIBUTION_CHAIN_ID=8453`

## ESM/CJS Notes

Project has `"type": "module"`. Hardhat workaround:
- Config: `.cts` extension (forces CJS)
- Tests: `.cjs` extension (Mocha 10.x CJS-in-ESM bridge)
- Always prefix: `TS_NODE_PROJECT=tsconfig.hardhat.json` (baked into `hardhat:*` scripts)

## Run Commands

```bash
pnpm hardhat:test      # 72/72 passing
pnpm hardhat:compile   # compile + typechain
pnpm test              # Vitest — 147/147 across 5 suites
pnpm forge:test        # Forge — 36/36
pnpm test:all          # vitest + hardhat + forge in sequence
```
