# Mintware — Smart-Contract Audit-Readiness Dossier

> **Purpose.** The single hand-off document for an external smart-contract audit of the Mintware
> vault / YPN / V4-hook stack. It states the scope, the architecture and money-path, the trust model,
> the invariants we already assert, the known-issues, and how to build and reproduce everything — so
> an auditor can start on day one instead of reverse-engineering intent.
>
> **Companion:** [`pre-audit-findings-ledger.md`](pre-audit-findings-ledger.md) maps the 2026-08-15
> external SOTA review's findings to their fixes + test evidence. This dossier is the wider frame.

---

## 0. Status & honesty (read first)

- **Everything in scope is testnet + unaudited.** The **only** mainnet contract is `AIAttribution` v3
  on Base (out of scope for this engagement — it is a separate, older, already-live reputation contract).
- The vault / YPN / settlement / MEV stack is deployed **only to Base Sepolia and Circle's Arc testnet**,
  is **empty**, and is **not** presented to users as live. External audit is the gate before real value.
- The stack landed on `main` on 2026-08-18 (PR #264) as a **dark launch** — all money surfaces are
  flag/env-gated off in production. Being on `main` does **not** mean it is live.

## 1. Audit scope

**Reference commit:** `dcfdc283` (merge of `feat/ypn-vault-convergence` into `main`, 2026-08-18).
**Language / toolchain:** Solidity (Foundry/Forge); Uniswap **v4** hooks (implement `IHooks` directly —
`BaseHook` does not exist in the pinned v4-core/periphery).

### In scope

| Area | Path | Why |
|---|---|---|
| DeFi LP vault universe | `contracts-v4/src/vaults/` | The dual-sided pair-vault lineage + adapters + migrator + registry |
| YPN treasury / spendable stack | `contracts-v4/src/payments/` | Senior/junior tranche vault, JIT hook, payment gateway, ETH settlement, CCTP router, multi-tenant factory |
| V4 hooks + MEV engine | `contracts-v4/src/hooks/` | `MWHookCoordinator` + dynamic/surge fee + oracle guard + am-AMM + Diamond-LVR |
| Shared libraries | `contracts-v4/src/lib/` | `SeniorSharesMath`, `MWGuardianPausable`, timelocked signer, `HookMiner` |

*(Exact contract inventory + SLOC in §5.)*

### Out of scope (named for completeness)

- `contracts-ai/src/AIAttribution.sol` — the live Base-mainnet reputation contract (separate lineage).
- The Rust off-chain services (`services/edge-auth`, `services/relayer`) — see §10; they carry their own
  test suites and are a *separate* review surface (they never custody funds; they authorize + submit).
- The Next.js app / API routes (`app/`, `lib/`) — web2 surface, not the contract audit.
- Business/legal controls that gate real value but aren't code: a card BIN sponsor / issuing bank / KYC,
  and a named float facility (see the findings ledger, finding #6).

## 2. System architecture — the money path

Mintware vaults are **dual-sided** liquidity on Uniswap v4: a team commits its own token as one side,
the community matches with the quote (USDC) side; the team side is lock-cliffed (>= 90 days). The
canonical lineage is `MintwarePairVault` (abstract base) → `MintwareDeFiPairVault` (general balanced LP)
and `MintwareMatchedLiquidityVault` (team-locked/community-matched launch).

The **YPN** ("Yield Payment Network") treasury vault extends that lineage with four layers that make a
vault balance **spendable as USDC while it keeps earning**:

1. **Price-free par-senior NAV** — community USDC is *senior* and redeemable ~1:1 (valued at par, not
   marked-to-market against a manipulable LP unit price). Team capital is *junior* / first-loss.
2. **Aave rehypothecation** of idle senior capital (idle-first, ~80% target buffer).
3. **JIT hook seam** (`MintwareTreasuryJitHook`) — borrow idle → just-in-time provision the V4 position
   on a swap → settle atomically; junior backstops; senior NAV is untouched. Guarded by a
   manipulation-resistant *truncated in-pool* oracle (`MWOracleGuard`) and a PnL breaker.
4. **Spendable gateway** (`MintwarePaymentGateway.settleSpend` / `burnForPayment`) — an EIP-712 permit
   burns senior shares and pays a merchant/payee in USDC. A spend is a **hold** against the earning
   position, then a settle — capital never "un-parks."

**Cross-chain:** capital earns on Base and settles as USDC on Circle's **Arc** L1 (chain `5042002`,
USDC is the gas token), bridged via **CCTP** (`MintwareCctpDepositRouter` lands bridged USDC as
yield-earning shares). Contracts are chain-agnostic (EIP-712 reads `block.chainid`).

**MEV engine** (all levers OFF/inert by default, oracle-free except the truncated in-pool oracle):
dynamic/surge/quadratic fee, MEV-tax (Base-only bonus — never counted as solvency), am-AMM (Harberger
rent + hook enrollment), and Diamond-LVR (a *directional* surcharge charged only on the gap-closing/arb
swap, recapturing LVR to LPs without taxing benign flow).

## 3. Coverage / solvency model (the properties that matter)

- **Senior par-coverage:** senior USDC must always be redeemable at par; the junior tranche + the
  always-liquid buffer absorb loss first. `_pullSeniorForDeploy` / `_pullUSDC` **revert rather than
  underpay** — senior never takes a principal loss from a thin-market junior sale (worst case is
  liveness, not loss).
- **Coverage-ratio floor (pre-audit #7b):** at-risk senior cannot grow past what the junior USDC
  buffer covers. `deployToLP` reverts `CoverageTooLow`; `borrowIdleForJit` skips when the cushion thins.
  Junior is valued at a **100% haircut** — only the USDC buffer counts, never the volatile junior token
  at spot (nothing circular / read-only-reentrancy-exposed to read).
- **Withdrawable-now vs deployed:** JIT borrow gates on `min(totalAssets, maxWithdrawable)`, and every
  external leg (Aave) is best-effort — a freeze falls through to "skip JIT, deltas net zero, swap
  proceeds," never a revert of the user's swap.
- **Inflation defense:** one shared `SeniorSharesMath` with a symmetric virtual offset (`VIRTUAL = 1e6`
  on the treasury vault); mint rounds down, previewWithdraw rounds up.

## 4. Trust model & privileged roles

**Access-control primitives:** `onlyOwner` (96 call-sites), `onlyFactory`, `onlyGateway`, `onlyJitHook`,
`onlyRelayer`, `onlyVault`, `onlyCoordinator`, `onlyPoolManager`/`_onlyPoolManager`, `onlyTeam`,
`onlyGuardianOrOwner`, `onlyOracle`, `onlyProvider`/`onlyHook`/`notDuringJit`, plus a multi-actor
`require(msg.sender == …)` gate in `FeeVault` (hook/socialVault/treasury/distributor).

| Actor | Gate | Can do | Blast radius |
|---|---|---|---|
| **Owner** | `Ownable` (single-key on most; `Ownable2Step` only on `AIAttribution`) | Repoint gateway/relayer/oracle/hook/adapter/rent-funder; rewrite **all** fee/JIT/oracle-bound/MEV params; `setMinCoverage`, `resetJitBreaker`, `recoverFromLP` (pull USDC from the LP); on `MintwareEthSettlement` **`withdrawWethBacking`/`withdrawJuniorBuffer`** (move backing/buffer out); set the `FeeVault` Merkle root; pause/unpause | **Highest — fully trusted.** Key mgmt + a timelock/multisig are the central mitigation to scrutinize |
| **Guardian** | `onlyGuardianOrOwner` | `pause()` only (no unpause, no fund movement) | Low — pause-only kill-switch |
| **Oracle signer** | `MWTimelockedOracleSigner` (distributor, attribution) / live `onlyOracle` (AIAttribution) | Authorize EIP-712 epoch-close / attribution payloads | Rotation is timelocked; a compromised *current* signer can authorize bad payloads until rotation completes. The AI `onlyOracle` is a hotter live key |
| **Relayer** | `onlyRelayer` | Drive `MintwareEthSettlement` batch settlement + `MintwareCctpDepositRouter` deposits | Bounded — settlement only within oracle bands |
| **Gateway** | `onlyGateway` | Burn senior shares / settle spends against the yield + treasury vaults | Bounded — burn only via the settlement path |
| **Team** | `onlyTeam` | `teamWithdraw` (subject to ≥90d cliff, invariant-enforced); barred from matching community liquidity (`TeamCannotMatch` self-dealing guard) | Bounded by the lock invariant |
| **PoolManager** | `onlyPoolManager` | Sole caller of hook callbacks + `unlockCallback` | **Trusted external assumption** (canonical Uniswap V4); dispatch paths are deliberately *not* `nonReentrant` (documented) |
| **Factory / Coordinator / Provider** | scoped | Deploy/wire vaults; drive the hook; rebalance idle | Single-purpose, bounded |

**Bottom line for the auditor:** the **owner is the dominant risk** — a compromised owner can move
settlement backing/junior buffer out, pull LP USDC, reset the loss breaker, and repoint every trusted
seam. Most contracts are single-key `Ownable`. The central review question is owner key management and
whether a timelock/multisig gates the fund-moving + risk-envelope setters. Guardian, relayer, gateway,
factory, and team are all low-to-bounded blast radius by design.

## 5. Contract inventory

Build config: root `foundry.toml` — `src = contracts-v4/src`, `solc 0.8.26`, `via_ir = true`,
`optimizer_runs = 200`. **`contracts-v4/src/` = 37 files, ~9,445 SLOC** (raw `wc -l`, incl. comments).
No production contract lives under `test/`; all mocks/helpers are under `contracts-v4/test/`.

### `vaults/` — DeFi LP vault universe
| File | Contract | Purpose | SLOC |
|---|---|---|---|
| `MintwarePairVault.sol` | abstract `MintwarePairVault` | Dual-sided base (guardian-pausable, `_onlyPoolManager`, V4 settlement) | 85 |
| `MintwareDeFiPairVault.sol` | `MintwareDeFiPairVault` | **Canonical** balanced-LP pair vault (largest — watch EIP-170) | 1280 |
| `MintwareMatchedLiquidityVault.sol` | `MintwareMatchedLiquidityVault` | Team-locked / community-matched launch vault (≥90d cliff, `onlyTeam`) | 805 |
| `Mintwarev3ToV4Migrator.sol` | `Mintwarev3ToV4Migrator` | One-tx Uniswap v3 LP → v4 pair-vault migration | 309 |
| `MintwareMultiVenueYieldAdapter.sol` | `MintwareMultiVenueYieldAdapter` | Curator multi-venue idle-yield fan-out (`onlyVault`) | 197 |
| `AaveV3YieldAdapter.sol` | `AaveV3YieldAdapter` | Aave v3 rehypothecation adapter (`onlyVault`) | 181 |
| `MintwareERC4626YieldAdapter.sol` | `MintwareERC4626YieldAdapter` | Fee-aware ERC-4626 adapter (Arc seam, `onlyVault`) | 163 |
| `MintwareVaultRegistry.sol` | `MintwareVaultRegistry` | Multi-tenant DeFi vault registry | 95 |
| `lib/MWJitLib.sol` · `lib/MWIdleLib.sol` · `lib/MWPositionLib.sol` | libraries | JIT / idle-rebalance / position math | 280 · 261 · 161 |
| `IYieldAdapter.sol` · `VaultTypes.sol` · `aave/IAaveV3.sol` | iface / types / ifaces | Adapter iface · shared structs · minimal Aave ifaces | 31 · 46 · 59 |

### `payments/` — YPN spend stack
| File | Contract | Purpose | SLOC |
|---|---|---|---|
| `MintwareTreasuryVault.sol` | `MintwareTreasuryVault` | YPN v2 senior/junior tranche vault, price-free NAV, spendable | 840 |
| `MintwareTreasuryJitHook.sol` | `MintwareTreasuryJitHook` | Standalone V4 JIT hook — borrow-idle → JIT → settle | 733 |
| `MintwareEthSettlement.sol` | `MintwareEthSettlement` | Oracle-bounded batch ETH→USDC settlement (`onlyRelayer`) | 375 |
| `lib/MWTreasuryPositionLib.sol` | library | Delegatecall position lib (vault self-holds its V4 position) | 276 |
| `MintwareYieldVault.sol` | `MintwareYieldVault` | v1 flat-senior USDC vault (live Arc-testnet instance, `onlyGateway`) | 245 |
| `MintwarePaymentGateway.sol` | `MintwarePaymentGateway` | Card rail — `settleSpend`/`burnForPayment` (AccessControl) | 223 |
| `MintwareTreasuryVaultFactory.sol` | `MintwareTreasuryVaultFactory` | Multi-tenant CREATE2 deploy/track for YPN vaults | 205 |
| `MintwareTreasuryVaultRegistry.sol` | `MintwareTreasuryVaultRegistry` | YPN vault registry (`factory`/`owner`-gated) | 125 |
| `MintwareCctpDepositRouter.sol` | `MintwareCctpDepositRouter` | CCTP receive-and-deposit (`onlyRelayer`) | 106 |
| `MintwareTreasuryDeployers.sol` | `…JitHookDeployer` / `…GatewayDeployer` | CREATE2 sub-deployers (`onlyFactory`) | 91 |
| `IYieldVault.sol` | interface | Shared YPN vault interface | 21 |

### `hooks/` — V4 hooks + MEV engine
| File | Contract | Purpose | SLOC |
|---|---|---|---|
| `MWHookCoordinator.sol` | `MWHookCoordinator` | Canonical V4 hook — dynamic/surge fee, am-AMM, JIT dispatch (`onlyPoolManager`) | 489 |
| `MWAmAuction.sol` | `MWAmAuction` | am-AMM rent auction / manager enrollment (`onlyCoordinator`) | 294 |
| `MWAmAuctionLib.sol` · `MWDynamicFee.sol` · `MWOracleGuard.sol` | libraries | am-AMM rent math · fee math · truncated in-pool oracle | 149 · 148 · 70 |

### `lib/` — shared
| File | Contract | Purpose | SLOC |
|---|---|---|---|
| `SeniorSharesMath.sol` | library | Senior-share / virtual-offset inflation defense | 36 |
| `MWGuardianPausable.sol` | abstract | Guardian/owner kill-switch base | 57 |
| `MWTimelockedOracleSigner.sol` | abstract | Timelocked oracle-signer rotation base | 78 |
| `HookMiner.sol` | library | CREATE2 salt mining for hook permission bits | 93 |

### Root + `attribution/` (in `contracts-v4/src`)
| File | Contract | Purpose | SLOC |
|---|---|---|---|
| `MintwareWeightedDistributor.sol` | `MintwareWeightedDistributor` | Reward Rail B — sig-verified vault-weighted epoch close/claim | 371 |
| `FeeVault.sol` | `FeeVault` | Epoch fee accounting + Merkle distribution (multi-actor gate) | 308 |
| `attribution/MintwareAttributionToken.sol` | `MintwareAttributionToken` | Soulbound (ERC-5192) attribution NFT, timelocked signer | 159 |

### Out of scope — `contracts-ai/src/`
| File | Contract | Purpose | SLOC |
|---|---|---|---|
| `AIAttribution.sol` | `AIAttribution` | On-chain AI attribution registry (live on Base; `onlyOracle`) | 385 |
| `interfaces/IERC8004Registry.sol` | interface | ERC-8004 registry interface | 28 |

> ⚠ **Label discrepancy for the auditor:** `AIAttribution.sol` self-titles **"v2"** while the docs
> (`smart-contracts.md`) call the live contract **"v3."** Unresolved; flag which is canonical. (Out of scope.)

## 6. Invariants under test

**42 `invariant_*` + 11 `testFuzz_*` functions**, each with a `StdInvariant` handler + targeted
selectors. **Run config (pinned):** `foundry.toml` pins `[profile.default.invariant] runs=256, depth=500`
→ every invariant runs at exactly **"runs: 256, calls: 128,000, reverts: 0"** (verified), matching the
suites' natspec. A deeper `[profile.deep]` (`runs=512, depth=1000`) is available for pre-audit sign-off
via `FOUNDRY_PROFILE=deep forge test`.

**YPN treasury solvency / coverage** — `MintwareTreasuryVaultInvariant.t.sol`:
`invariant_senior_par_covered` (deployed senior par ≤ junior stack), `invariant_senior_fully_backed`,
`invariant_senior_price_free` (NAV is a pure accounting identity — no price term), `invariant_no_share_inflation`,
`invariant_settlement_conserves` (no USDC fabricated), `invariant_reserved_junior_backed`,
`invariant_lock_enforced` (junior never redeemed before the cliff) + a non-vacuity `afterInvariant` guard.

**JIT / DeFi pair-vault solvency** — `MintwareDeFiPairVaultJitInvariant.t.sol`:
`invariant_jit_zero_at_rest` (JIT leg fully vanishes between txs), `invariant_solvency_incl_open_jit`
(solvency holds even mid-open-JIT), `invariant_jit_roundtrip_conserves`, `invariant_delta_settled`
(every V4 delta settled each swap), `invariant_swap_never_bricks` (a swap always completes despite Aave
illiquidity / paused / hostile adapter), `invariant_rounding_favors_vault`; plus the base-suite pooled/
aave/fee-reserve/shares/monotonic set (`MintwareDeFiPairVaultInvariant.t.sol`).

**am-AMM / MEV** — `MWAmAuctionInvariant.t.sol` (`invariant_solvency`, `…_reserve_is_exact_multiple`,
`…_fee_never_exceeds_cap`) and `MWHookCoordinatorAmAmmInvariant.t.sol` (`invariant_c0_solvency`,
`invariant_c1_solvency` — token balances == escrows + ledgers).

**Matched-liquidity vault** — `MintwareMatchedLiquidityVaultInvariant.t.sol`:
`invariant_team_cannot_exit_early`, `invariant_community_shares_never_grow`, `invariant_position_backs_split`.

**v1 yield vault** — `MintwareYieldVaultInvariant.t.sol`: solvency, settlement-conserves, nav-monotonic,
no-unauthorized-settlement, permit-reusable-and-bounded, rounding-favors-vault.

**Reward distributor** — `MintwareWeightedDistributorInvariant.t.sol`: per-token `Conservation0/1`,
`ClaimsNeverExceedFunding`.

**Fuzz (`testFuzz_*`)**: fee-math bounds/monotonicity/overflow (`MWHooksLib`, `MWDynamicFeeLvr`),
`testFuzz_jitLive_keepsSeniorSolvent`, `testFuzz_RailFullyPaidOrReverts`, roundtrip/no-value-creation
(`MintwareDeFiPairVaultJit`/`…Buffered`), `testFuzz_setShares_rejects_invalid_sum` (`FeeVault`).

**Formal-style proofs** — `test/formal/MWFormalProofs.t.sol`: symbolic `check_*` properties (fee within
ceiling/base, rate-limit step, split-fee conserves + favors LP, redeem-idle rounds down, deposit/mint no
inflation).

## 7. Threat model

**Assets at risk:** senior USDC principal (par redeemability); the junior first-loss buffer; the
always-liquid hot buffer backing card float; the V4 LP position value; oracle integrity.

**Attacker capabilities to assume:** an arbitrary caller who can `PoolManager.unlock()` and craft
`PoolKey`/`hookData`; a same-block price manipulator (flash-loaned); an MEV searcher sandwiching the
keeper unwind; a patient multi-block oracle pusher; a compromised keeper; and (bounded) a compromised
owner/guardian (see §4).

**Prior-art exploit classes we explicitly defend (and want the auditor to re-break):**
- Hook callback auth + pool-key binding (Cork, $11M) — `onlyPoolManager` + immutable canonical pool id;
  non-canonical keys no-op.
- Accounting conservation / rounding-sign leak (Bunni v2, $8.3M) — PnL vs actually-transferred USDC;
  senior-non-decreasing fuzz.
- Sandwichable keeper sweep — oracle-bounded `minAmountOut` (`min(spot, oracle)`), revert outside band.
- Seniority-swap fire-sale (MakerDAO Black Thursday) — revert-not-underpay + the coverage-ratio floor.
- Aave-liquidity assumption (Apr-2026 freeze) — withdrawable-now gating + best-effort fall-through.
- NAV read-only-reentrancy / spot-priced collateral — price-free par NAV + 100%-haircut junior.

Full mapping + test evidence: [`pre-audit-findings-ledger.md`](pre-audit-findings-ledger.md).

## 8. Known issues & accepted risks

- **Open for the auditor (model-level):** a *sustained multi-block* oracle push against the
  `_seniorFullyCovered` junior-release path — the truncated oracle blunts single-block manipulation, but
  the clamp economics under a patient attacker want an independent re-check (aligns with the
  Black-Thursday concern).
- **Not code (business/legal), gate real value:** a card BIN sponsor / issuing bank / KYC and a named
  float facility (findings-ledger #6). The on-chain job is only to never let a spend un-back senior.
- **Dormant path parity:** the Redis increment-3 authorization path (`services/edge-auth/src/redis_lua.rs`,
  not wired to the server) does not yet mirror the hot-buffer / circuit-breaker gates the live path has —
  documented inline as a PARITY TODO.
- **Deploy-gated remainder (not audit blockers):** a live relayer `settle` HTTP endpoint + funded key;
  the single→pair frontend ABI cutover; Arc mainnet.
- **Invariant depth — ✅ FIXED (this dossier's companion commit):** `foundry.toml` now pins
  `[profile.default.invariant] runs=256, depth=500` (= 128,000 calls, the documented budget) plus a
  deeper opt-in `[profile.deep]`. Auditors re-running `forge test` get the exact headline numbers.
- **Owner is single-key `Ownable` on most contracts** (only `AIAttribution` uses `Ownable2Step`). Given
  the owner's fund-moving powers (§4), moving ownership behind a timelock + multisig before mainnet is a
  standing recommendation, not an optional nicety.
- **Doc label / count nits:** `AIAttribution.sol` says "v2" vs docs' "v3" (§5); `.claude/rules/testing.md`
  carries a stale "36/36" line in a historical section (current self-consistent figure: 463/0/4).

## 9. Deploy topology

| Network (chain) | Contract | Address | Status |
|---|---|---|---|
| **Base mainnet (8453)** | `AIAttribution` v3 | `0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421` | Live — **out of scope** |
| Base Sepolia (84532) | ULV vault | `0x6c0d…5132` | testnet, empty |
| Base Sepolia (84532) | ULV hook | `0x9f3c…0AC8` | testnet |
| Base Sepolia (84532) | ETH-collateral vault | `0x09Cda8519737a60FD16D263f94fb56237CDb7E42` | testnet |
| Base Sepolia (84532) | `MintwareEthSettlement` | `0x20140811123db9C00CA1dF1023BA4fE758B98c5F` | testnet |
| Arc testnet (5042002) | `MintwareYieldVault` | `0x11Ef…C421` | testnet (YPN spend stack) |
| Arc testnet (5042002) | `MintwarePaymentGateway` | `0x1D07…5399` | testnet |
| Arc testnet (5042002) | `MintwareERC4626YieldAdapter` | `0xb9FB…2B88` | testnet |
| Arc testnet (5042002) | CCTP deposit router | `0xDB9D…Fc03` | testnet |

> The Arc addresses coincidentally string-match the Base AIAttribution addresses (same deployer nonce,
> different chains) — they are unrelated contracts. Full deploy record + on-chain proofs:
> [`session-handoff-arc.md`](session-handoff-arc.md).

## 10. Off-chain components (context, not in the contract-audit scope)

| Service | Role | Custody? |
|---|---|---|
| `services/edge-auth` (Rust/axum) | Sub-150ms card authorization: decide → reserve a hold off cached NAV with a VaR haircut → sign. Fail-closed bearer. | No — authorizes only |
| `services/relayer` (Rust) | Builds + submits `settleSpend` + CCTP orchestration. A signing/submission library — no HTTP server yet. | No — submits only |

Both are `cargo test` + `cargo clippy -D warnings` clean. They never hold user funds; the on-chain
gateway + vault are the custody + solvency boundary.

## 11. How to build, test, and reproduce

```bash
export PATH="$HOME/.foundry/bin:$PATH"
pnpm forge:build         # compile v4 contracts
pnpm forge:test          # full suite incl. invariants (see §6 depth caveat — pin an [invariant] profile)
pnpm forge:test:gas      # with gas report
# off-chain services:
cd services/edge-auth && cargo test && cargo clippy --all-targets -- -D warnings
cd services/relayer   && cargo test && cargo clippy --all-targets -- -D warnings
```

**Test surface (as of the reference commit):** Forge **489 pass / 0 fail / 6 skipped** (the 6 are
mainnet-fork harnesses in `contracts-v4/test/fork/` that self-skip without `BASE_RPC_URL`);
edge-auth **86**; relayer **23**; Vitest **~220** (web2). *(Exact per-file counts in §6.)*

## 12. Auditor logistics

- **Start-here checklist** is in [`pre-audit-findings-ledger.md`](pre-audit-findings-ledger.md) §"Auditor start-here."
- **Key V4 facts to avoid re-learning:** implement `IHooks` directly (no `BaseHook`); hook addresses
  carry permission bits mined via CREATE2 (`lib/HookMiner.sol`); the afterSwap settlement gotcha (the
  swapper settles input last → take-or-mint-ERC6909-claim + keeper sweep).
- **Design/architecture references:** `docs/developers/vault-architecture-map.md`,
  `vault-consolidation-plan.md`, and the phase-2/3 convergence blueprints.
