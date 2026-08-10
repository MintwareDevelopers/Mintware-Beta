# Mintware — Smart-Contract Architecture & Review Handoff

**Audience:** an external team reviewing the on-chain system.
**Branch this describes:** `fix/audit-findings` (the branch carrying the internal-audit fixes; PR #92 → `main`).
**Prepared:** 2026-08-09.

This document is a map, not a marketing deck. It states what the **source actually does today**, flags
what is legacy / not-yet-landed, and points to the exact files. Where an internal assessment (our own
audit) differs from what a contract's own comments say, both are given so you can adjudicate.

---

## 0. TL;DR for reviewers

- **Two on-chain surfaces that matter for a review:** (1) the **Uniswap V4 vault + hook system** (Solidity
  0.8.26, Foundry, in `contracts-v4/`), and (2) a **legacy single-contract campaign distributor** (Hardhat,
  in `contracts/`). A third dependency, **AIAttribution v3**, is live on Base mainnet but its source is *not*
  in this repo.
- **The reward/attribution weighting is computed OFF-CHAIN** and injected via an **oracle signature**. The
  chain verifies *provenance* (a known signer signed a bounded root), not *correctness* of the weighting.
  This is the single most important trust boundary — see §6.
- **Nothing in `contracts-v4/` is confirmed deployed to mainnet.** Scripts exist and pass tests; the only
  live contracts from this stack are retired Phase-2 predecessors on Base Sepolia. Treat all addresses in
  runbooks as placeholders pending on-chain confirmation (§7).
- An **internal adversarial audit** (`docs/developers/full-audit-2026-08-09.md`, 35 findings) has been run;
  all go-forward CRITICAL/HIGH are fixed on this branch, two HIGH are scope-bounded (not fully closed), and
  some MED/LOW are deferred. **An independent external review is explicitly wanted** for correlated-blind-spot
  coverage — that is why you are reading this.

---

## 1. System overview

Three contract families plus an off-chain layer.

```
                          ┌─────────────────────────── OFF-CHAIN ───────────────────────────┐
                          │  Attribution scorer (external worker + lib/attribution/*)         │
                          │  Reward pipeline (lib/rewards/*)  →  Oracle signer (EIP-712)       │
                          └───────────────┬──────────────────────────────┬───────────────────┘
                                          │ signs epoch roots             │ signs score attestations
                                          ▼                               ▼
   ┌──────────────── UNISWAP V4 VAULT + HOOK SYSTEM (contracts-v4/) ────────────────┐   ┌── attribution mirror ──┐
   │                                                                                │   │ MintwareAttributionToken│
   │  Vaults (LP position managers)          Hook (one contract, all pools)         │   │  (soulbound, EIP-5192)  │
   │  ├─ MintwareDeFiVault4626  ─────┐        MWHookCoordinator (IHooks, 0xAC8)      │   └─────────────────────────┘
   │  │   (single-sided, ERC-4626)   │        ├─ vault-only LP gate                  │
   │  ├─ MintwareDeFiPairVault  ─────┼──LP──▶ ├─ truncated-oracle circuit breaker     │
   │  │   (dual-sided, shares=liq)   │        ├─ deviation-priced dynamic fee         │
   │  └─ MintwareMatchedLiquidityVault        └─ am-AMM manager-fee skim (MWAmAuction)│
   │      (team-locked launch)       │                                              │
   │            │ fees                │                                              │
   │            ▼                     ▼                                              │
   │  Reward legs:  FeeVault (legacy, Merkle)   |   MintwareWeightedDistributor (Rail B, EIP-712 + Merkle) │
   └────────────────────────────────────────────────────────────────────────────────┘

   ┌──────────── LEGACY CAMPAIGN DISTRIBUTOR (contracts/) ────────────┐
   │  MintwareDistributor.sol v2 — per-campaign single-token Merkle    │
   │  claims, EIP-712 + deadline, 48h oracle rotation, batchClaim      │
   └──────────────────────────────────────────────────────────────────┘
```

**Reading guide:** the *go-forward* DeFi design is the **pair vault** + **MWHookCoordinator** + **Rail-B
weighted distributor**. The *single-sided 4626* + *FeeVault* is the earlier stack (still the one the deploy
runbook ships) that the internal audit wants to retire — see §4.1 and §8 for the nuance.

---

## 2. Standards & conventions

| Concern | Choice | Where |
|---|---|---|
| Solidity | `^0.8.26`, uniform across all 22 `contracts-v4/src` files | `foundry.toml` (`solc 0.8.26`, `optimizer 200`, `via_ir=true`) |
| V4 vault standard | **ERC-4626** (single-sided family only) | `MintwareBaseVault4626` |
| Pair-vault shares | **Not** ERC-4626 — a share *is* a Uniswap V4 liquidity unit | `MintwarePairVault` family |
| Uniswap V4 hooks | Implements **`IHooks` directly** (NOT v4 `BaseHook`) | `MWHookCoordinator` |
| Hook permission bits | `HOOK_FLAGS = 0xAC8` = `beforeAddLiquidity(0x800) + beforeRemoveLiquidity(0x200) + beforeSwap(0x80) + afterSwap(0x40) + beforeSwapReturnDelta(0x8)` | `MWHookCoordinator.sol:60`, validated in ctor |
| Signed authorizations | **EIP-712** typed data (on-chain epochs, score attestations) + **EIP-191** personal-sign (off-chain API auth) | distributors, attribution token, `lib/web2/routeHandler.ts` |
| Soulbound token | **EIP-5192** (`Locked` at mint, transfers blocked in `_update`) | `MintwareAttributionToken` |
| Merkle claims | OZ `MerkleProof`, **StandardMerkleTree** leaf encoding: `keccak256(bytes.concat(keccak256(abi.encode(...))))` (abi.encode, 64-byte-padded — **not** abi.encodePacked) | distributors |
| Auction | **am-AMM** Harberger-lease (arXiv:2403.03367, BidDog semantics) | `MWAmAuction` + `MWAmAuctionLib` |
| Libraries | OpenZeppelin **5.6.1**, Uniswap v4-core `v4.0.0-19` (`891b327a`), v4-periphery `686f621`, forge-std `1.15.0` | `.gitmodules`, submodule `package.json` |

**Repo-wide security conventions** (cite these when reviewing any contract):

- **`ReentrancyGuard` / `nonReentrant`** on every value-moving external function (all vaults, FeeVault,
  `MWAmAuction`, `MintwareWeightedDistributor`).
- **CEI ordering** — effects committed before external calls; balance-diff/post-transfer assertions where a
  token could lie (e.g. `MintwareDeFiVault4626` adapter checks, `AdapterTransferMismatch`).
- **Guardian kill-switch** — `MWGuardianPausable` (`contracts-v4/src/lib/`): a `guardian` (monitoring
  multisig) can **pause instantly**, only `owner` can **unpause** ("fast pause, deliberate unpause").
  **Deliberately does NOT gate swap callbacks** — a reverting `beforeSwap` would brick the pool; pause
  targets mutations (deposits/rebalances) only. Inherited by all vaults and the hook coordinator.
- **Timelocked oracle rotation** — `MWTimelockedOracleSigner` (`contracts-v4/src/lib/`): 48h
  propose→confirm→(cancel); the current signer stays active during the window. Inherited by the 4626 base,
  the weighted distributor, and the attribution token. (Legacy `FeeVault.setOracleSigner` is **instant, no
  timelock** — flagged, see §8.)
- **Fee-on-transfer safety** — balance-diff intake (credit what actually arrived) in every deposit path of
  the pair/matched/4626 vaults.
- **Hook-address mining** — `HookMiner.find(...)` CREATE2 salt-mines an address whose low 14 bits equal the
  required permission flags; all deploy scripts mine against the canonical CREATE2 factory
  `0x4e59b44847b379578588920cA78FbF26c0B4956C`.
- **Invariant / fuzz testing** — 11 `invariant_*` suites + `testFuzz*` cases (see §7).

---

## 3. Contract inventory — Vault family (`contracts-v4/src/vaults/`)

Two architecturally distinct families live here.

### 3.1 `MintwareBaseVault4626.sol` — abstract ERC-4626 base
- **Standards / inheritance:** `ERC4626`, `ERC20` (OZ), `MWGuardianPausable`, `MWTimelockedOracleSigner`,
  `ReentrancyGuard`, `IUnlockCallback` (v4-core), `EIP712`.
- **Share semantics (design decision "D5"):** a share is a claim on **USDC principal** —
  `totalAssets() == totalPrincipal` (`:192-193`), **not** live LP NAV. Yield is distributed via FeeVault
  epochs, not via share price. Redemption is semi-liquid: instant only for unlocked/Flex positions past a
  24h hold, otherwise an async 7-day notice queue (`requestRedeem`→`executeRedeem`).
- **Access control:** `owner` (rebalance, oracle rotation, `setFeeVault` one-time); `guardian` (pause);
  `oracleSigner` (permissionless `rebalanceWithProposal` with EIP-712 + nonce); `PoolManager`
  (`unlockCallback` only).
- **Unwired Phase-4 stubs:** `_calculateDynamicFee` and `_rebalanceIdleCapital` are explicit RESERVED
  no-ops (`:545-557`) — documented, not live.

### 3.2 `MintwareDeFiVault4626.sol` — single-sided DeFi vault (the earlier "go-live" stack)
- **Inheritance:** `MintwareBaseVault4626`.
- **Model:** deposits single-sided USDC into a V4 pool against a **team-seeded PROJECT token**
  (`seedTeamTokens`, onlyOwner). Swap-fee split 50/25/25 (depositor/Mintware/provider); optional
  rehypothecation of idle capital to a yield adapter (allowlisted, 48h timelock, ≥20% withdrawal buffer
  always retained, cap 70% default / 80% hard).
- **Reputation weighting:** this is the vault whose fees route to `FeeVault` and are reputation-weighted.
- **⚠ Reviewer note (the par-NAV point — read §8.1):** shares are principal-denominated (D5); the internal
  audit assesses this as a first-mover/bank-run risk *when* principal is deployed as single-sided LP that
  converts to the team token on swaps. As of 2026-08-10 the vault + base + `DeployPhase3.s.sol` carry an
  in-code **DEPRECATED** notice pointing to the pair vault, and the registry can retire it
  (`deactivateVault`). The par-principal *behavior* is unchanged; the *frontend* cutover to the pair vault is
  deploy-gated. Reviewers should still judge whether par-principal accounting over single-sided LP is
  acceptable at all.

### 3.3 `MintwarePairVault.sol` — abstract dual-sided base
- **Inheritance:** `MWGuardianPausable`, `ReentrancyGuard`. Holds only the genuinely-shared V4 settlement
  plumbing (`_settleDelta`/`_pay`/`_initializePool`, pool identity + range). Fee accounting and unlock
  dispatch are intentionally left to subclasses (they differ: all-liquidity vs team-excluded denominator).

### 3.4 `MintwareDeFiPairVault.sol` — true dual-sided pair vault (go-forward DeFi)
- **Inheritance:** `MintwarePairVault`, `IUnlockCallback`. **Not ERC-4626** — a share is a V4 liquidity unit.
- **Key accounting:** `totalLiquidity` (== total **shares**) is decoupled from **`positionLiquidity`**
  (the actual V4 liquidity in the active range). Deposit mints `totalLiquidity * liq / positionLiquidity`;
  redeem removes `positionLiquidity * s / totalLiquidity` (rounds down, so the vault never over-removes and
  the last redeemer can always exit). This decoupling is the **audit HIGH #4 fix** — before it, a rebalance
  re-derived the raw liquidity number and 1:1 share→liquidity removal locked out late redeemers
  (`:102-108`, `:256-258`, `:313-320`).
- **Two-token on-chain fee accrual:** `accFee0/1PerShare` + per-LP debt; a **segregated `feeReserve0/1`** so
  a rebalance never sweeps LP-owed fees into the position.
- **am-AMM rent sink:** `fundRent` (callable only by the wired auction) credits rent to LPs exactly like
  swap fees. Optional Rail-B routing via `setWeightedDistributor`.
- **Access control:** `owner`; `provider` (= provider or owner) for `initializePool`/`rebalanceToProfile`;
  `rentFunder` (the auction); `PoolManager`.

### 3.5 `MintwareMatchedLiquidityVault.sol` — team-locked / community-matched launch vault
- **Inheritance:** `MintwarePairVault`, `IUnlockCallback`. Largest contract (~795 lines), purpose-built.
- **Model:** team commits `T` project tokens + declares a match cap; community fills the quote side
  (USDC/WETH/…); if the threshold is met in the funding window, `activate()` (permissionless) deploys one V4
  position split **50/50 by liquidity** into a **LOCKED team half** and a **FREE community half**.
- **The lock is the product guarantee:** `teamLiquidity` is zeroed only in `teamWithdraw`, hard-gated on
  `block.timestamp >= lockExpiry` (min 90d). **There is deliberately no team-initiated early-unlock path**;
  the guardian pause can *freeze* but never *release*. While locked, swap fees accrue to community units
  only (team excluded from the denominator, earns 0%).
- **Deep-dived separately** (`docs/developers/matched-vault-audit-2026-08-09.md`): lock integrity and
  solvency held; the sibling's rebalance bug is *designed out* (deploy-once, shares are literal 1:1 V4
  liquidity). Fixes landed this cycle: atomic front-run-proof pool init in `commitTeam`, FoT balance-diff
  intake, canonical-hook binding (`expectedHook`/`setExpectedHook`), pro-rata strand refund
  (`claimUndeployedQuote`), JIT distributor approval.

### 3.6 Factory / registry / types
- **`MintwareVaultFactory.sol`** — `onlyOwner` `createVault` CREATE2-deploys a {Vault, FeeVault} pair and
  wires them; **RWA surface reverts `RWANotImplemented`** (DeFi only). Not used by the current deploy path.
- **`MintwareVaultRegistry.sol`** — `onlyOwner` on-chain registry of deployed vaults (Supabase indexes it);
  `feeVault` may be `address(0)` for pair vaults. This is the artifact the Phase-3 script actually uses.
- **`VaultTypes.sol`** — enums/structs: `VaultSurface{DeFi,RWA}`, `PoolProfile{BLUE_CHIP,EMERGING,MEME}`
  (600/1200/2400 tick half-widths), `LockTier{Flex,Committed,Aligned,Core}` (0/30/90/180d; 1.00–1.50×).
- **`IYieldAdapter.sol`** — pluggable idle-capital sink interface (USDC in/out); only a mock exercises it.

---

## 4. Contract inventory — Hook + am-AMM family (`contracts-v4/src/hooks/`, `/lib/`)

### 4.1 `MWHookCoordinator.sol` — the single V4 hook
- **Standards:** `IHooks, MWGuardianPausable`. Implements `IHooks` directly. `HOOK_FLAGS = 0xAC8` (decoded
  in §2). One coordinator serves all Mintware pools.
- **Four jobs:**
  1. **Vault-only LP gate** — `beforeAddLiquidity`/`beforeRemoveLiquidity` revert unless `sender == vault`
     (only the vault may add/remove liquidity; direct LPs are blocked). Add is `whenNotPaused`; remove is
     **not** paused (positions can always exit).
  2. **Circuit breaker** — `beforeSwap` reverts swaps at extreme deviation from a **truncated tick oracle**
     (`MWOracleGuard`).
  3. **Deviation-priced dynamic fee** — non-am-AMM pools get a volatility fee that scales with deviation,
     rate-limited per block.
  4. **am-AMM manager-fee skim** — enrolled pools let the current auction manager skim a fee on the
     specified (input) currency; the delta nets to zero across the unlock (see below).
- **Circuit-breaker deadlock fix (audit HIGH #3):** the oracle only advances in `afterSwap`, but a breaker
  trip reverts in `beforeSwap` before `afterSwap` runs — so one large swap could permanently brick the pool.
  A **permissionless `pokeOracle(key)`** (`:325-332`) advances the truncated oracle toward spot using the
  same clamped per-block budget, so the pool self-heals over blocks. The breaker still hard-halts swaps at
  extreme deviation (protective), it just can no longer deadlock.
- **Delta accounting (manager-fee skim → net zero):** exact-input only (`ExactOutputNotSupported` by
  default; owner opt-in per pool). Fee = `amt * feePips / 1e6` (floored, `feePips < 1e6`).
  `POOL_MANAGER.take(spec, auction, fee)` books `-fee` to the hook; `return toBeforeSwapDelta(+fee, 0)` books
  `+fee` on the specified delta → nets zero. The trader pays; LPs earn nothing on managed swaps (the manager
  bought the flow).
- **Access control:** all callbacks `onlyPoolManager`; admin (`setVault`, `setAuction` one-shot,
  `setAmAmmEnabled`, `setAllowExactOutput`, `configurePool`) `onlyOwner`; `pokeOracle` permissionless.

### 4.2 `MWOracleGuard.sol` — truncated-oracle library (pure)
- Storage-struct library, no V4 types (unit-testable in isolation). A lagging tick reference that advances
  at most `maxTickMovePerBlock` per block and is frozen intra-block, so a single-block price push barely
  moves it. Replaces the retired `tx.origin`-keyed sandwich cooldown; works for single- and multi-address
  attackers. `checkCircuitBreaker` reverts beyond `maxDeviationTicks`.

### 4.3 `MWDynamicFee.sol` — fee math (pure)
- `volatilityFee` (deviation→fee, capped) + `rateLimit` (per-block clamp). *(The dead `applyDepthDiscount`
  was removed 2026-08-10.)*

### 4.4 `MWAmAuction.sol` + `MWAmAuctionLib.sol` — Harberger-lease auction
- **`MWAmAuction`** (`Ownable`, `ReentrancyGuard`): custody of bid deposits + captured manager fees, the
  auction state machine (`poke`), rent→LP push (`_fundRent` to the pair vault's `fundRent`), and a
  **pull-payment ledger** (`owed[account][token]` + `claim`). `poke`/`recordManagerFee` are `onlyCoordinator`.
  Rent economics are **live**: rent flows to LPs, manager fees to the manager.
- **`MWAmAuctionLib`** (pure): rent/reserve/promotion math, "promotable-only occupancy" anti-squat
  (`validBid`), no-free-exit (`canWithdraw`). *(The dead `AmParams.withdrawFeeBps` field was removed 2026-08-10.)*
- **Escrow-freeze fix (audit MED):** `withdrawFromBid` waives the K-block continuity reserve **when the pool
  is disabled** (no continuity to protect, so escrow can't be stranded); while enabled the reserve still
  blocks a free cancel.

### 4.5 Shared libs
- **`HookMiner.sol`** — CREATE2 salt mining for the hook's permission bits (§2).
- **`MWGuardianPausable.sol`** / **`MWTimelockedOracleSigner.sol`** — the kill-switch and 48h oracle-rotation
  primitives described in §2.

---

## 5. Contract inventory — Distribution, rewards & other

### 5.1 `MintwareWeightedDistributor.sol` — Rail-B reward path (go-forward)
- **Standards:** `EIP712`, `MWGuardianPausable`, `MWTimelockedOracleSigner`, `ReentrancyGuard`; OZ
  `MerkleProof`. Multi-tenant, **two-token**, oracle-signed, per-epoch Merkle distributor.
- **Epoch model:** `registerVault` (immutable token pair, records `funder`) → `fundFees` (permissionless,
  pulls into the open epoch pot) → `closeEpoch` (the trust step: requires the epoch duration elapsed and a
  valid EIP-712 signature over `EpochRoot(vaultId, epochNumber, merkleRoot, total0, total1, deadline)` from
  the `oracleSigner`) → `claim` (Merkle proof, one per epoch, CEI) → `sweep` (after 90d, unclaimed → funder).
- **Fixes present in source (this cycle):**
  - **`claim()` post-sweep guard** — `if (e.swept) revert AlreadySwept();` (audit **CRIT #1**).
  - **`registerVault` allowlist** — `if (!authorizedRegistrar[msg.sender] && msg.sender != owner()) revert
    NotAuthorizedRegistrar();` (audit **MED**, funder-hijack front-run guard) + owner `setAuthorizedRegistrar`.
- **Defenses:** over-allocation guard at close (`total ≤ pot`), per-claim cumulative guard, one-claim-per-epoch.
- **Trust:** the off-chain merkle builder owns the weighting formula; the chain enforces only provenance +
  bounded pot. A wrong/malicious signed root can mis-split a **bounded** pot but cannot mint value.

### 5.2 `FeeVault.sol` — legacy DeFi-surface fee accumulator
- **Standards:** `Ownable`, `ReentrancyGuard`, `EIP712`. Accrues trading fees + penalties, splits at epoch
  close (70/15/10/5 LP/referrer/protocol/bonus), settles via `MintwareDistributor` Merkle claims.
- **⚠ Known limitation (audit C1), still live in source:** `closeEpoch(bytes32 merkleRoot)` takes only the
  root, is `onlyOwner`, and **never verifies the oracle signature** despite the typehash and docstring — the
  attestation machinery is dead. `setOracleSigner` is **instant (no timelock)**. This is precisely the
  weakness `MintwareWeightedDistributor` was built to replace.
- **Deployment:** part of the `DeployPhase3` stack the audit flags as "do not put real value on."

### 5.3 `MintwareAttributionToken.sol` — soulbound score mirror
- **Standards:** `ERC721`, `EIP712`, `IERC5192` (soulbound), `MWTimelockedOracleSigner`. Mirrors a wallet's
  off-chain Attribution score on-chain via an oracle-signed attestation (per-wallet nonce replay guard,
  transfers blocked in `_update`, mint-once). **This is NOT ERC-8004** — it's a minimal EIP-5192 soulbound
  token. Track C; not in the current deploy script.

### 5.4 `contracts/MintwareDistributor.sol` v2 — legacy campaign distributor (Hardhat)
- **Standards:** `EIP712, Ownable, Pausable, ReentrancyGuard`. Single-token, per-campaign Merkle claims with
  **EIP-712 + `deadline`** (blocks stale-sig replay; chainId in the domain blocks cross-chain replay),
  `batchClaim`, 48h oracle-rotation timelock (the reference the shared lib mirrors), and a
  deposit/close/withdraw(7d cooldown)/emergency lifecycle. Optional bridge that calls `FeeVault.recordClaim`.
- Address supplied via env (`MINTWARE_DISTRIBUTOR`), not pinned in the repo.

### 5.5 External dependency — AIAttribution v3
- Documented live on **Base mainnet `0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421`** (verified on Basescan).
  **Source is not in this repo** — treat as an external dependency for the review.

---

## 6. Trust model & off-chain boundary (review this first)

The on-chain contracts are honest about what they *don't* verify. The economically important trust sits
off-chain:

1. **Oracle signer** (`lib/web3/onchainPublisher.ts`, key via `lib/web3/oracleKeys.ts`): signs EIP-712 epoch
   roots. The chain trusts that a **known signer** signed a **bounded** root — it does not (and cannot)
   verify the *weighting math*. Mitigations: 48h `MWTimelockedOracleSigner` rotation + guardian pause.
2. **Attribution scorer** (`lib/attribution/*` + an external Cloudflare worker): computes the reputation
   score that drives reward weighting and (optionally) the soulbound mirror. A compromised scorer skews
   weighting within bounded pots.
3. **Key custody (KNOWN/LOW):** the root/merkle oracle key currently doubles as treasury custody — flagged in
   the internal audit; separation recommended.

Reviewers should assume: honest, uncompromised signer + scorer, and a bounded blast radius (a bad signed root
mis-splits a funded pot; it cannot mint value or drain other epochs — the CRIT #1 sweep-guard fix closes the
one path that could reach other epochs).

---

## 7. Build, test & deploy

### Build / test
- **Foundry** (V4 stack): `pnpm forge:build`, `pnpm forge:test` (`solc 0.8.26`, `via_ir=true`).
- **Hardhat** (legacy distributor): `pnpm hardhat:test` (config `hardhat.config.cts`).
- **Vitest** (off-chain TS): `pnpm test`. **All three:** `pnpm test:all`.

### Test coverage (static discovery on this branch)
| Suite | Count | Notes |
|---|---|---|
| Forge (V4) | **257 unit/fuzz + 11 invariant** | invariants: matched-vault solvency, am-AMM auction, hook+am-AMM, weighted distributor |
| Hardhat (legacy) | **74** | single file `contracts/test/MintwareDistributor.test.cjs` |
| Vitest (off-chain) | **~256–262** | reward math, epoch/merkle, swap hook, attribution, route-handler auth |

### Deploy scripts (`contracts-v4/script/`)
| Script | Deploys | Stack |
|---|---|---|
| `DeployPhase3.s.sol` | FeeVault + `MintwareDeFiVault4626` + `MWHookCoordinator` + `MintwareVaultRegistry` | single-sided 4626 (the stack the audit is retiring) |
| `DeployPairVault.s.sol` | `MintwareDeFiPairVault` + coordinator + registry (+ optional Rail B) | dual-sided pair vault (solvent go-forward) |
| `DeployMatchedVault.s.sol` | `MintwareMatchedLiquidityVault` then coordinator (vault baked into hook args) | team-locked launch vault |
| `DeployWeightedDistributor.s.sol` | `MintwareWeightedDistributor` + one single-sided USDC vault | Rail-B claim leg |

### Deployment status — **be skeptical of addresses**
- **No `broadcast/` artifacts exist** in `contracts-v4/`. The stack is **built, tested, and merged, but not
  confirmed deployed** to any network. Addresses that appear in `docs/developers/phase3-deploy-runbook.md`
  (e.g. a `0x8dd4…` vault, a `0x53dd…` FeeVault) are **placeholders/examples** contradicted by
  `phase3-golive-runbook.md` ("not deployed anywhere") — confirm on-chain before trusting any of them.
- The only live contracts from this lineage are the **retired Phase-2** `SocialVault`/`MWSocialHook` on Base
  Sepolia. **AIAttribution v3** is the one confirmed-live mainnet contract (external, §5.5).

---

## 8. Known issues, dead code & audit status

### 8.1 The par-NAV / deprecation nuance (most important to adjudicate)
- **In code:** `MintwareDeFiVault4626` uses principal-denominated shares (`totalAssets() == totalPrincipal`,
  design "D5"). This is intentional and documented in the contract.
- **Internal assessment (NOT in the contract's own comments):** `docs/developers/full-audit-2026-08-09.md`
  **CRIT #2** judges that because principal is deployed as single-sided USDC LP that converts to the team
  token on swaps, par-principal redemption can leave a **first-mover / bank-run shortfall**. The internal
  plan is to **retire this vault** in favour of the solvent pair vault.
- **Update (2026-08-10):** the vault + base + `DeployPhase3.s.sol` now carry an in-code **DEPRECATED** notice
  pointing to the solvent pair vault, and `MintwareVaultRegistry.deactivateVault` can retire on-chain
  instances. The **behavior** is still principal-denominated (D5) — the remaining *frontend* cutover
  (single→pair ABI) is deploy-gated on the pair vault going live and is tracked as its own task. **We'd still
  value your independent read on whether par-principal accounting over single-sided LP is acceptable at all.**

### 8.2 Internal audit — status summary
`docs/developers/full-audit-2026-08-09.md` (35 findings) + `matched-vault-audit-2026-08-09.md` (deep-dive).
On this branch:
- **CRIT #1** (distributor claim-after-sweep) — ✅ fixed. **CRIT #2** (par-NAV) — ◐ deprecated in-code +
  registry retirement; frontend cutover deploy-gated (§8.1).
- **HIGH #3** (breaker deadlock) ✅, **#4** (pair rebalance shares==liq) ✅, **#5** (swap tx.to null) ✅,
  **#8** (frontend XSS) ✅, **#9** (treasury guard) ✅.
- **HIGH #6/#7** (spoofable fee substring + client-trusted `amount_usd`) — ✅ **fixed (2026-08-10)** via
  server-recorded quotes: `/api/swap/quote` records the server-computed USD value (LI.FI
  `estimate.fromAmountUSD`) in `swap_quotes` keyed by a `quote_id`; the reward path uses that wallet-bound,
  TTL'd value (`lib/rewards/resolveQuote.ts`) instead of the client claim. The prior caps remain as
  defense-in-depth.
- **MED go-forward** — ✅ registerVault allowlist, ✅ am-AMM setEnabled escrow escape, ✅ `javascript:` XSS,
  ✅ pool pre-init, ✅ signed-message replay binding, ✅ token-pool deduction idempotency (all merged).
- The audit's own **independence note** recommends one external set of eyes before real value at scale.

### 8.3 Dead code / tooling cruft — **cleaned 2026-08-10**
- `MWDynamicFee.applyDepthDiscount` & `MWAmAuctionLib.AmParams.withdrawFeeBps` — **removed** (+ `volatilityFee`
  params renamed to `deviationTicks`/`slopePipsPerTick`).
- `foundry.toml` Pyth remapping & the phantom `forge:deploy:*` scripts (`Deploy.s.sol`, `DeployRwaVaultDemo`,
  `DeployRwaOraclePoolDemo`) — **removed**; real `forge:deploy:{pair,matched,weighted}` scripts added.
- `MintwareVaultRegistry.VaultDeactivated` — **now functional** (`deactivateVault` + `active` flag + `isActive`).
- Still open (intentional): `MintwareBaseVault4626._calculateDynamicFee` / `_rebalanceIdleCapital` — RESERVED
  Phase-4 stubs.
- Param-naming mismatch: `MWDynamicFee.volatilityFee(volatilityBps, slopePipsPerBp)` is actually fed
  *ticks* / *pips-per-tick* by the coordinator (cosmetic, but confusing for spec review).

---

## 9. Suggested review focus

1. **The off-chain trust boundary (§6)** — is "chain verifies provenance, not correctness of weighting" an
   acceptable model for your risk tolerance? Key-custody separation (oracle vs treasury).
2. **Par-NAV single-sided vault (§8.1)** — accept the D5 principal accounting, or require the pair-vault
   migration before mainnet value?
3. **Pair-vault `positionLiquidity`/shares accounting** (`MintwareDeFiPairVault`) — verify the rounding
   direction and that no rebalance sequence can strand or over-pay a redeemer (the HIGH #4 fix).
4. **Matched-vault lock integrity & activation state machine** — confirm no path releases team liquidity
   before `lockExpiry`, and the pre-init / hook-binding front-run defenses hold.
5. **Hook delta accounting** (`MWHookCoordinator` am-AMM skim) — confirm the `beforeSwap` skim nets to zero
   across the unlock and exact-output is genuinely closed.
6. **Distributor epoch/claim/sweep** (`MintwareWeightedDistributor`) — the CRIT #1 sweep-guard and the
   over-allocation / one-claim-per-epoch invariants.
7. **HIGH #6/#7** — whether the caps + allowlist are an adequate interim bound or the server-recorded-quotes
   fix must land first.

---

## Appendix — key file index
- **Go-forward contracts:** `contracts-v4/src/vaults/{MintwareDeFiPairVault,MintwareMatchedLiquidityVault,MintwarePairVault,MintwareBaseVault4626}.sol`, `contracts-v4/src/MintwareWeightedDistributor.sol`, `contracts-v4/src/hooks/MWHookCoordinator.sol`
- **Hook/auction libs:** `contracts-v4/src/hooks/{MWOracleGuard,MWDynamicFee,MWAmAuction,MWAmAuctionLib}.sol`, `contracts-v4/src/lib/{HookMiner,MWGuardianPausable,MWTimelockedOracleSigner}.sol`
- **Single-sided / legacy:** `contracts-v4/src/vaults/MintwareDeFiVault4626.sol`, `contracts-v4/src/FeeVault.sol`, `contracts/MintwareDistributor.sol`
- **Attribution mirror:** `contracts-v4/src/attribution/MintwareAttributionToken.sol`
- **Deploy:** `contracts-v4/script/{DeployPhase3,DeployPairVault,DeployMatchedVault,DeployWeightedDistributor}.s.sol`
- **Off-chain trust:** `lib/web3/onchainPublisher.ts`, `lib/rewards/`, `lib/attribution/`
- **Audits:** `docs/developers/{full-audit-2026-08-09,matched-vault-audit-2026-08-09,oracle-audit-and-hardening-plan}.md`
- **Build:** `foundry.toml`, `hardhat.config.cts`, `.gitmodules`, `package.json`
