# Testing

## Test Suites

| Suite | Runner | Count | Command |
|---|---|---|---|
| Contract tests | Hardhat/Mocha | 72/72 | `pnpm hardhat:test` |
| Unit tests | Vitest | 147/147 | `pnpm test` |
| Contract tests (Phase 2) | Forge | 36/36 | `pnpm forge:test` |
| All | — | — | `pnpm test:all` |

## Vitest Suites (`pnpm test`)

- `calc.test.ts` — reward calculation
- `epochProcessor.test.ts` — epoch payout formula
- `utils.test.ts` — shared utilities
- `swapHook.test.ts` — swap hook logic + multipliers
- `merkleBuilder.test.ts` — Merkle tree construction

## Hardhat Notes

- Config: `hardhat.config.cts` (`.cts` forces CJS with `"type":"module"`)
- Tests: `contracts/test/MintwareDistributor.test.cjs` (`.cjs` for Mocha 10.x)
- Always use: `TS_NODE_PROJECT=tsconfig.hardhat.json` (baked into `hardhat:*` scripts)
- Never use `.ts`/`.cts` for test files — Mocha CJS-in-ESM bridge requires `.cjs`

## Forge Notes

- Binary: `~/.foundry/bin/forge`
- Add to PATH: `export PATH="$HOME/.foundry/bin:$PATH"`
- Tests in `contracts-v4/test/` — currently stubbed (Phase 2 T1 work)
- `contracts-v4/out/` gitignored

## Key Invariants to Test

- Leaf encoding: `abi.encode` (64-byte), NOT `abi.encodePacked` (52-byte)
- Score multipliers applied at point-credit time only (not payout time)
- `pending_rewards` unique constraint: `(campaign_id, tx_hash, reward_type)`
- Oracle EIP-712 includes `deadline` in typed data
- `verifySwapTx` checks `LIFI_ROUTERS` set (not single address)
