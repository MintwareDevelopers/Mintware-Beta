# Testing

## Test Suites

| Suite | Runner | Count | Command |
|---|---|---|---|
| Contract tests | Hardhat/Mocha | 72/72 | `pnpm hardhat:test` |
| Unit tests | Vitest | 147/147 | `pnpm test` |
| Contract tests (V4/Phase 2+3) | Forge | 195/195 | `pnpm forge:test` |
| All | — | — | `pnpm test:all` |

## Vitest Suites (`pnpm test`)

- `calc.test.ts` — reward calculation
- `epochProcessor.test.ts` — epoch payout formula
- `utils.test.ts` — shared utilities
- `swapHook.test.ts` — swap hook logic + multipliers
- `merkleBuilder.test.ts` — Merkle tree construction
- `holdSnapshot.test.ts` — RWA hold-credit math + idempotent writer (campaign-scoped tx_hash, rollback-on-rpc-error)
- `holdLocks.test.ts` — R5 lock decode guard: vault `locks()` getter returns `(depositedAt, lockedUntil, tier, initialized)`; `lockedUntil` is index **1** (not 0)

## Hardhat Notes

- Config: `hardhat.config.cts` (`.cts` forces CJS with `"type":"module"`)
- Tests: `contracts/test/MintwareDistributor.test.cjs` (`.cjs` for Mocha 10.x)
- Always use: `TS_NODE_PROJECT=tsconfig.hardhat.json` (baked into `hardhat:*` scripts)
- Never use `.ts`/`.cts` for test files — Mocha CJS-in-ESM bridge requires `.cjs`

## Forge Notes

- Binary: `~/.foundry/bin/forge`
- Add to PATH: `export PATH="$HOME/.foundry/bin:$PATH"`
- Tests in `contracts-v4/test/` — real (no longer stubbed): full V4 stack against a live `PoolManager`
  (`Integration.t.sol` is the reference harness — real pool seed/deposit/swap; mirror it for new swap tests)
- `MWRouter.t.sol` — internal swap router: exact fee accounting, best-exec floor (net of hook capture +
  router fee), guards, admin cap, and the two-stream proof (router fee to treasury coexists with the hook's
  MEV capture to FeeVault on one swap). See [[mw_router]].
- `contracts-v4/out/` gitignored

## Key Invariants to Test

- Leaf encoding: `abi.encode` (64-byte), NOT `abi.encodePacked` (52-byte)
- Score multipliers applied at point-credit time only (not payout time)
- `pending_rewards` unique constraint: `(campaign_id, tx_hash, reward_type)`
- Oracle EIP-712 includes `deadline` in typed data
- `verifySwapTx` checks `LIFI_ROUTERS` set (not single address)
