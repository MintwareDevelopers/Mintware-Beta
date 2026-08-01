# Smart Contracts

> **⤴ Phase 3 (Two-Surface Vaults)** adds a new contract family — `MintwareBaseVault4626`,
> `MintwareVaultFactory`, `MintwareDeFiVault4626` / `MintwareRWAVault4626`, `MintwareVRWA`,
> `MintwareOracleHook`, SPV/KYC registries, a soulbound `MintwareAttributionToken`, and `MWRouter`
> (internal best-execution swap router — `contracts-v4/src/MWRouter.sol`, 14 forge tests; skims a
> capped router fee to treasury, floor enforced net of hook capture + fee; off-chain decision engine in
> `lib/web2/router/`; see [`docs/developers/phase3-router-design.md`](../../docs/developers/phase3-router-design.md)).
> Target design + sequencing: [`docs/developers/phase3-two-surface-architecture.md`](../../docs/developers/phase3-two-surface-architecture.md).
> The contracts below are the **current** deployed set; Phase-3 contracts are documented here as they merge.

## MintwareDistributor v2 — Base Mainnet

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
pnpm hardhat:deploy:core-dao       # Core DAO (1116)
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
