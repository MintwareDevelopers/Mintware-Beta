# World A → World B Cutover Plan

_Authored 2026-08-10. Grounded in firsthand code reads + a live `forge test` run, not doc claims.
The goal: collapse two disconnected vault codebases into one live, audited stack so that every
contract improvement (solvency fix, MEV recapture, reputation-weighted rewards) stops being inert._

---

## The problem in one line

The live app deposits into a **retired ghost** (`SocialVault`, source deleted from the repo), while
the entire audited **World B** stack (`MintwareDeFiPairVault` + `MWHookCoordinator` + `MWAmAuction` +
`MintwareWeightedDistributor` + registry) is **deployed nowhere and wired to nothing**. Fixing
individual contracts doesn't move the product; the value is trapped behind a missing migration.

## Scope boundary (hold this firm)

This migration is **NOT** the "ULV" Aave/JIT idle-capital feature. World B = the dual-sided pair
vault stack. The "idle capital in Aave, just-in-time liquidity pulled on swap" idea is a **separate
net-new layer built ON TOP of the unified stack later** (no lending integration exists today — only
a mock `IYieldAdapter`; `_rebalanceIdleCapital()` is an empty stub). Do not conflate them. Unify
first; ULV is a feature that needs a single real stack to build on.

## What is verified (firsthand, 2026-08-10)

- **MEV engine is real + tested.** `forge test` on the am-AMM suites → **71/71 pass, 0 fail**, incl.
  `test_exactInput_zeroForOne_skims_manager_fee`, `test_manager_can_claim_skimmed_fees`, and two
  solvency **invariants** at 256 runs × 128,000 calls, 0 reverts.
- **`MWAmAuction.sol` is a complete Harberger-lease auction** — managers bid for the right to set the
  pool fee + capture arb; pay per-block rent; rent is **pushed to the LP** via
  `IAmAmmRentSink.fundRent`. Carries audit fixes (F-B anti-squat, segregated `feeReserve`).
- **Rent routes vault-internal, NOT through FeeVault.** `MintwareDeFiPairVault.fundRent` credits LPs
  via the weighted distributor or a per-share accumulator, in the pool's own tokens. FeeVault is the
  separate USDC epoch/Merkle path. (Correcting an earlier mis-statement.)
- **F-D "don't enable until Stage-3 wiring" is stale.** Flagged-decisions doc `578914f4` (09:32)
  predates the Stage-3 hook skim commit `2bcd3bac` (10:07, same morning). The wiring landed.
- **World B is on-chain nowhere.** `deployments/base.json` = 1 contract (FeeVault `0x4Deb74…`, Mar);
  `base_sepolia.json` owner = `0xf39F…92266` = the public Anvil key (throwaway dev deploy).
- **No external price oracle is needed for MEV recapture** — it's discovered via bids. Only the
  existing truncated-tick `MWOracleGuard` (circuit breaker) is used. This is a security feature.

## Deploy MECHANISM = Privy admin routes (NOT forge broadcast)

Deploys run through **Privy server-wallet admin API routes** (built 2026-08-10 PM), signed by the
oracle-signer Privy wallet — NOT `forge script --broadcast`. Precompiled artifacts live in
`lib/web3/artifacts/` (`pairVault`, `hookCoordinator`, `weightedDistributor`, `campaignDistributor`).
The forge scripts under `contracts-v4/script/` are compile/reference only for this migration.

Existing routes (Base Sepolia, bearer-gated CRON_SECRET):

| Route | Deploys / wires | am-AMM? | Fee |
|---|---|---|---|
| `app/api/(admin)/oracle/deploy-pair-testnet` | mine 0xAC8 hook → pair vault (USDC/WETH) → `setVault` → `initializePool` | ❌ none | **static 3000** |
| `app/api/(admin)/oracle/deploy-weighted-testnet` | weighted distributor + `registerVault` (single-sided USDC `mw-weighted-vault-1`) | — | — |
| `app/api/(admin)/oracle/deploy-campaign-testnet` | campaign distributor (already proven live) | — | — |

**Gaps vs. the full go-live loop (genuinely NOT done this afternoon):**
1. **Rewards not connected to the pair vault** — `deploy-weighted-testnet` registers a *single-sided
   USDC* vaultId and never calls `setWeightedDistributor` / `setAuthorizedRegistrar` / `setRentFunder`
   on the pair vault. A wiring step (or a combined route) is missing. For a dual-sided pair vault the
   distributor must `registerVault(vaultId, token0, token1)` with BOTH tokens.
2. **am-AMM MEV absent from the deploy path** — no `amAuction` artifact, and the pool is **static-fee**,
   so it structurally cannot accept the hook fee override. Bundling MEV now requires: an `amAuction`
   artifact (bytecode/ABI) + a new/extended deploy route that deploys `MWAmAuction`, cross-wires
   (`setCoordinator`/`setAuction`/`setRentFunder`), re-inits the pool as **dynamic-fee**
   (`DYNAMIC_FEE_FLAG`), `configurePool` + `setAmAmmEnabled` — plus the fork-fuzz gate.

Am-AMM wiring sequence (for the eventual route — verified against the contracts):
`auction.setCoordinator(hook)` · `hook.setAuction(auction)` · `vault.setRentFunder(auction)` ·
`auction.configurePool(poolId, rentSink=vault, AmParams{enabled,bidToken,feeMaxPips,defaultFeePips,minRent,K,minBidMultBps})` ·
`hook.setAmAmmEnabled(poolId, true)`. AmParams: `K≈7200` (≈4h @ Base 2s blocks), `minBidMultBps≥11000`.

---

## The plan

### Step 1a — Deploy the solvent vault stack to Base Sepolia + prove the loop
Reuse the campaign-distributor playbook (Privy operator wallet, on-chain smoke test).
- Decide the first pair (test tokens on Sepolia).
- `forge script DeployPairVault.s.sol` with env: `DEPLOYER_PRIVATE_KEY`, `V4_POOL_MANAGER`,
  `TOKEN_A_ADDRESS`, `TOKEN_B_ADDRESS`, `TREASURY_ADDRESS`, plus `WEIGHTED_DISTRIBUTOR` +
  `DISTRIBUTOR_VAULT_ID` to wire Rail B.
- **Prove on-chain:** deposit BOTH tokens → shares == V4 liquidity units → swap → LP earns fees →
  `claimFees` pays out. (Rewards: weighted distributor epoch close → claim.)
- **DoD:** a real deposit→swap→claim round on Sepolia, addresses recorded in `deployments/`.

### Step 1b — Layer MEV recapture (separate, later, deliberately enabled)
- Extend the deploy (or a new script): deploy `MWAmAuction`, `auction.setCoordinator(hook)`,
  `hook.setAuction(auction)`, `auction.configurePool` + `hook.configurePool`/`setAmAmmEnabled`,
  keeping hook and auction **in sync** (owner responsibility, flagged in code).
- **Fork-fuzz** the skim against real routers before enabling; keep exact-output disabled until fuzzed.
- Per-pool `setEnabled(true)` only when the hook wiring is present in the same change (F-D gate).
- **DoD:** on-chain round where a manager wins the auction, rent is charged, `fundRent` credits an LP.

### Step 2 — Repoint the app (deploy-gated on Step 1a)
15 files reference the legacy SocialVault. Two classes:
- **~10 mechanical ABI/address swaps:** `lib/web3/vault/useSocialVault.ts`,
  `lib/web3/vault/socialVaultAbi.ts`, `app/api/(rewards)/vault/deposit/route.ts` + `withdraw/route.ts`,
  `app/(rewards)/vault/[id]/page.tsx`, `app/(rewards)/vaults/page.tsx`,
  `components/web2/vault/VaultCard.tsx`, `lib/web2/vault/types.ts`, `app/api/(web2)/vaults/route.ts`,
  `lib/web3/oracleKeys.ts`.
- **~5 shape changes (redesign, not swap):** the rebalance pipeline (`lib/web3/vault/rangeProposer.ts`,
  `useRebalanceProposal.ts`, `app/api/(web2)/vault/rebalance-proposals/mark-submitted/route.ts`,
  `lib/rewards/vault/vaultEpochProcessor.ts`) targets `SocialVault.rebalanceWithProposal(signed range)`,
  but the pair vault uses `rebalanceToProfile(PoolProfile) onlyProvider` — **drop/replace, do not port.**
  `app/(rewards)/vault/create/page.tsx` is a Supabase insert today — rebuild to call the factory or
  gate owner-only.
- Deposit now requires **both** tokens (pair vault), not single-sided — update deposit UX + validation.

### Step 3 — Retire World A (safety-gated)
- **Precondition:** confirm the ghost holds ≈0 real funds — query `lp_deposits` + on-chain
  `SocialVault` balance. The deposit API *does* accept real Base-mainnet deposits, so verify, don't
  assume. If ≈0: de-fake the seeded vault list, remove `NEXT_PUBLIC_SOCIAL_VAULT_ADDRESS`, one source
  of truth. If not ≈0: migrate positions first.

### Gate before mainnet real value
Per the flagged-decisions doc: **external audit is the gate before real value.** Sequence:
prove full cutover on Sepolia (1a → 2 → 3) → external audit → mainnet. MEV (1b) can ride the same
audit or a follow-on, but must be audited before mainnet enablement.

## Open decisions (need operator input)
1. First pair for the Sepolia prove-out (which two test tokens).
2. Deploy identity — reuse the Privy operator wallet used for the campaign distributor?
3. Rail B rewards on at go-live (wire `WEIGHTED_DISTRIBUTOR`) or vault-first, rewards second?
4. Step 1b (MEV) — bundle into the first cutover, or ship the solvent vault first and layer MEV after?
