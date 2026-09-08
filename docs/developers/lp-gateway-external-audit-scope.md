# LP Gateway V1 — External Audit Scope & RFP Package

**Purpose.** Everything an external audit firm needs to quote, scope, and start on the Mintware **LP Gateway V1**
before any **third-party funds** are admitted. Written to be verified, not trusted: every number below was
measured with the command shown, and every claim links to its source document or test.

**Drafted:** 2026-09-08, against the audit close-out commit (see §2.1). **Contact / comms:** §9.
**Standing posture:** testnet only, mock tokens, *externally unaudited*. No mainnet contract exists. Nothing in
this document, the repo, or the product copy presents the gateway as a deposit, savings, guaranteed or fixed-APY
product; a liquidity position carries impermanent loss.

---

## 1. System description and trust model

**One paragraph.** A depositor puts **USDG** (Paxos, 6 dp) into a per-pool gateway (`MintwareLpGatewayPositionManager`,
"PM") and receives **entry-NAV shares** (symmetric virtual-offset math, `SeniorSharesMath`, `VIRTUAL = 1e6`). The
USDG is immediately **staged** into a single-controller reserve (`MintwareLpGatewayStaging`) that holds it as shares of
an ERC-4626 yield source (Morpho on Robinhood Chain) through a fee-aware adapter (`MintwareERC4626YieldAdapter`), so
idle capital earns from block one. The gateway **owner** may `deploy` at most **50 % of depositor principal at cost**
(`MAX_DEPLOY_BPS = 5000`, a constant) plus its *own* paired-token leg as one aggregate position in an **existing,
hookless, curated Uniswap v4 pool**, through the official v4 `PositionManager` periphery and Permit2. `harvest`
collects accrued fees with a zero-liquidity-delta decrease (principal untouched) to a **48 h-timelock-rotatable
`harvestRecipient`**; `compoundQuote` lets the owner stage net fees back (NAV up, no mint). `withdraw` is **pure
pro-rata** on both legs (share fraction of the idle reserve and of position liquidity — no price read sizes it),
each leg is **best-effort** and any undelivered fraction is **re-credited as shares**; a position's fees are swept to
the recipient *before* any principal decrease/increase (H-02). NAV marks the LP leg at spot, with a **clamped-follower
reference** (≤ `maxDeviationBps` of √price per block, default 500) that bounds entry pricing (`max(spot, ref)` on
deposit) and the deploy band; `poke()` is permissionless. `setPaused` blocks *new deposits only*; withdraw is never
gated. A curated `MintwareLpGatewayFactory` (Ownable2Step) spins up isolated (staging, PM) pairs per pool.

**Trust model — who can move money.**

| Actor | Can | Cannot |
|---|---|---|
| **Depositor** (any EOA/contract) | `deposit`/`depositWithMin`, `withdraw`/`withdrawWithMin` of *own* shares, `poke()` | touch another holder's shares; withdraw in the same block as its own deposit (`SameBlockAction`) |
| **PM owner** = the Privy **`gateway`** server-wallet seat `0x18AE027cF105393BF9Fe6a9F0d06A761D2a0663c` (Ownable2Step, renounce disabled) | `deploy` (≤ cap, inside the follower band, with caller `minLiquidity`), `harvest`, `compoundQuote`, `setPaused`, propose/accept/cancel the harvest recipient (48 h), two-step ownership transfer | sweep principal (no such function exists — verified in every round: RT-9d, A-3 §3 Q4); redirect an in-flight fee stream instantly; disable the deploy cap (constant); revert or block withdrawals |
| **Adapter owner** (same seat today) | `setPerBlockWithdrawCap` (instant, unbounded), one-time `setVault` | move funds (only `vault` = staging can `deposit`/`withdraw`) |
| **Staging `deployer`** (the factory or the deploy script signer) | one-time `setController` | anything after it is set |
| **Factory owner** (same seat) | `createGateway` (curation), `deactivate` (flag only) | reach into an instance |
| **Third parties that can freeze value:** Paxos (USDG `pause`/`freeze`/**`wipeFrozenAddress`**), the Morpho vault (pause, supply cap, `maxRedeem`), the paired-token issuer (if admin-controlled — excluded by policy), Uniswap v4 `PoolManager`/`PositionManager` (immutable, canonical) | | |

**On-chain vs off-chain.** Only the five contracts above hold or route value. The off-chain layer (`lib/gateway/*`,
`app/api/gateway/*`, four Vercel crons) *decides* what the owner seat signs (deploy sizing, harvest, circuit breaker),
records positions/fees in Supabase, and routes UI deposits to an instance via the registry. Crons are flag-gated OFF
by default and fail closed. The off-chain layer is **Module B (optional)** in this scope; the contracts are **Module A**.
Off-chain findings from our internal rounds are in [`audits/2026-09-08-consolidated.md`](audits/2026-09-08-consolidated.md) §3.

---

## 2. In-scope contracts (Module A — required)

### 2.1 Freeze commit

| | Value | How to check |
|---|---|---|
| Close-out commit (this document's target) | `23586164` — "feat(lp-gateway): audit close-out — every open finding from the Hacken-style + red-team round actioned" (branch `feat/lp-gateway`) | `git show 23586164 --stat` |
| Last commit on `origin/main` at drafting | `7b53d3c2` (PR #478, round-2 contract fixes) | `git log origin/main -1` |
| Delta close-out vs `origin/main`, in-scope `src/` only | 3 files, +179 / −15 (C-9a/C-9b/C-10 + timelocked recipient rotation) | `git diff --stat origin/main -- contracts-v4/src/gateway contracts-v4/src/vaults/MintwareERC4626YieldAdapter.sol contracts-v4/src/lib/SeniorSharesMath.sol` |

**Action before kickoff:** merge the close-out PR to `main`, then tag the merge commit `audit/lp-gateway-v1-freeze`
and hand the firm that SHA. The audit targets the tag, not a branch. Any fix during the engagement lands as a
separate tagged commit for the fix-review pass.

### 2.2 Files and size (`wc -l`, comments included; measured on `23586164`)

| File | LOC | Role | Runtime / initcode bytes (`forge build --sizes`) |
|---|---|---|---|
| `contracts-v4/src/gateway/MintwareLpGatewayPositionManager.sol` | 769 | Core: deposit / withdraw / deploy / harvest / compound, NAV, follower, share accounting, recipient rotation, C-10 tolerant read | 16,331 / 18,017 (margin 8,245) |
| `contracts-v4/src/gateway/MintwareLpGatewayStaging.sol` | 80 | Single-controller idle reserve over an `IYieldAdapter`; one-time deployer-only `setController` | 2,176 / 2,479 |
| `contracts-v4/src/gateway/MintwareLpGatewayFactory.sol` | 136 | Curated per-pool factory; adapter-reuse + adapter-binding guards | **23,631 / 24,038 — 945 B under EIP-170** |
| `contracts-v4/src/vaults/MintwareERC4626YieldAdapter.sol` | 178 | Fee-aware (`previewRedeem`) best-effort 4626 adapter; `onlyVault`, one-time `setVault`, per-block cap, Ownable2Step | 3,469 / 4,101 |
| `contracts-v4/src/vaults/IYieldAdapter.sol` | 31 | Adapter interface (best-effort `withdraw` contract) | — |
| `contracts-v4/src/lib/SeniorSharesMath.sol` | 36 | Symmetric virtual-offset `toShares`/`toAssets` | — (library, inlined) |
| **Total** | **1,230** | | |

Command: `wc -l contracts-v4/src/gateway/*.sol contracts-v4/src/vaults/MintwareERC4626YieldAdapter.sol contracts-v4/src/vaults/IYieldAdapter.sol contracts-v4/src/lib/SeniorSharesMath.sol`

Note: `MintwareERC4626YieldAdapter` is shared with the (out-of-scope) YPN treasury stack; audit it **as used by the
gateway** (staging is the `vault`; source = a Morpho ERC-4626). The factory's EIP-170 margin (945 B) is a known
constraint, not a finding — it embeds both child creation codes.

### 2.3 Toolchain (from `foundry.toml`, repo root — run `forge` from the repo root, not `contracts-v4/`)

| Setting | Value |
|---|---|
| `solc` | **0.8.26** (`pragma solidity ^0.8.26` in all in-scope files) |
| `via_ir` | **true** (profile `default`) |
| `optimizer` / `optimizer_runs` | true / **200** |
| Foundry | `forge 1.8.0` (commit `61ae26af`) — CI pins the same |
| Fuzz / invariant budget | `fuzz.runs = 256`; `invariant.runs = 256`, `depth = 500`, `fail_on_revert = false`. Deep profile: `FOUNDRY_PROFILE=deep` → 1024 fuzz runs, 512 × 1000 invariant |
| ⚠ `profile.test` | disables the optimizer **and** via-IR — do not audit bytecode under it; the deployed artifacts come from `default` |

Two via-IR gotchas the internal rounds hit (from `audits/closeout/contracts-residuals.md`): via-IR CSEs
`block.number`/`block.timestamp` across `vm.roll`/`vm.warp` in a single test — anchor on literals; and
`vm.prank(x); pm.withdraw(pm.sharesOf(x))` pranks the view call, not the withdraw.

### 2.4 External dependencies (vendored submodules under `contracts-v4/lib/`; commits read with `git rev-parse HEAD` in each)

| Dependency | Commit | Package version | Used for |
|---|---|---|---|
| `Uniswap/v4-core` | `d153b048868a60c2403a3ef5b2301bb247884d46` (`git describe`: v4.0.0-19-gd153b048) | 1.0.2 | `IPoolManager`, `StateLibrary` (slot0 read), `PoolKey`/`PoolId`, `TickMath`, `FullMath`, `SqrtPriceMath` |
| `Uniswap/v4-periphery` | `686f621d9b675fc78bf02781f59ec1ad36921706` | 1.0.4 | `IPositionManager` (`modifyLiquidities`, `getPositionLiquidity`, `nextTokenId`), `Actions` (MINT_POSITION / INCREASE_LIQUIDITY / DECREASE_LIQUIDITY / SETTLE_PAIR / TAKE_PAIR), `LiquidityAmounts` |
| Permit2 (nested submodule `v4-periphery/lib/permit2`) | `cc56ad0f3439c502c246fc5cfcc3db92bb8b7219` | — | **Not compiled** — the PM declares a local `IPermit2Minimal { approve(token, spender, uint160, uint48) }` and calls the canonical deployment `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| `OpenZeppelin/openzeppelin-contracts` | `ef5a2d02d3706e8fa2a13e5af9a306a25d32bfac` | **5.6.1** (per `package.json`) | `Ownable2Step`, `ReentrancyGuard`, `SafeERC20` (`forceApprove`), `Math`, `IERC4626` |
| `foundry-rs/forge-std` | `c0f966cb111f621bfb283b2a388bc7be18953bba` | 1.15.0 | tests only |

Remappings are in `foundry.toml`. `pyth-sdk-solidity` is remapped but **not imported** by any in-scope file.

**Deployed periphery ≠ vendored periphery.** The gateway calls the Robinhood Chain **deployed** `PositionManager`
(§4); the vendored `v4-periphery` commit is what the action encodings were written against. One explicit ask:
confirm the deployed bytecode's `CalldataDecoder`/action set matches the vendored commit for the five actions used
(realfunds re-audit test gap #12; the fork suites exercise it on testnet but nobody has diffed the bytecode).

---

## 3. Out of scope (and why)

| Excluded | Why |
|---|---|
| `contracts-v4/src/vaults/*` except the adapter + interface (pair vaults, matched-liquidity vault, registry, migrator, staged router, multi-venue adapter, Aave adapter) | Different product (DeFi/ULV vaults). The PM imports nothing from them. Base Sepolia only, empty, flag-gated off. |
| `contracts-v4/src/payments/*` (YPN treasury vault, payment gateway, ETH settlement, CCTP router, treasury factory) and `contracts-v4/src/hooks/*` (MEV engine, JIT hook) | The YPN/card/x402 stack — separate funds path, separate signer seat (`root`), separate audit. The LP gateway "touches none of the vault / JIT / YPN-treasury contracts" by design. |
| `contracts-ai/` (`AIAttribution` v3, the only mainnet contract) | Reputation registry; no value flow to the gateway. |
| `services/edge-auth`, `services/relayer` (Rust), `lib/x402/*`, `lib/cards/*`, `lib/org/*` | Card / x402 authorization + settlement. Not in the gateway's path. |
| Campaigns / rewards engine (`lib/rewards/*`, campaign tables) | **Shelved 2026-08-12**, removed from the platform; tables retained but unwritten. |
| The `/v1` UI, Discover feed (`lib/gateway/discovery.ts`, `riskScore.ts`, `sparkline.ts`), leaderboard, profile | Read-only browse surfaces; the feed never reaches an on-chain action; `riskScore` ranks, never certifies. Covered by the internal off-chain rounds. Module B may include the money-path subset only. |
| Deploy scripts (`scripts/*-lp-gateway-*.mjs`, `contracts-v4/script/*LpGateway*`) | Reviewed internally (I-02 preflights, 22 post-wire assertions); provide for context, not for findings. |

**Module B (optional, quote separately):** the off-chain money path — `lib/gateway/{registry,routeInstance,curateAuth,
recordAuth,deploy,harvest,harvestMath,ledger,chainTruth,circuitBreaker,alerts,v4Math,positionReader}.ts` (≈3.5 k
LOC non-test across `lib/gateway/*.ts`), routes `app/api/gateway/{deposit,withdraw,curate,meta,position,positions,
instances,request}`, crons `app/api/(rewards)/cron/gateway-{deploy,harvest,discover,snapshot}`, the seven
`supabase/migrations/2026090[678]*gateway*.sql`, and the signer resolution in `lib/web3/oracleSigner.ts`.

---

## 4. Deployed context

### 4.1 Chain: Robinhood Chain

| Fact | Value | Source |
|---|---|---|
| Mainnet chain id / RPC | **4663** / `https://rpc.mainnet.chain.robinhood.com` | `scripts/preflight-lp-gateway-mainnet.mjs` |
| Testnet chain id / RPC | **46630** / `https://rpc.testnet.chain.robinhood.com` | `scripts/deploy-lp-gateway-robinhood.mjs`, CI |
| Stack | Arbitrum Nitro / Orbit rollup. **`block.number` returns the L1 (Ethereum) block number (~12 s cadence)**, not an L2 sequencer block. | Hacken F-05 / consolidated C-11 |
| Consequence | The same-block guard, the follower step (`maxDeviationBps` per block), the deploy-band check and the adapter per-block cap are all **per ~12 s L1 block** — many L2 transactions share one `block.number`. The internal reviews rate this Info; §8 asks the firm to model it. | |

### 4.2 Canonical Uniswap v4 + Permit2 on Robinhood Chain (same addresses on 46630 and 4663)

| Contract | Address | Mainnet code size (preflight 2026-09-08) |
|---|---|---|
| `PoolManager` | `0x8366a39CC670B4001A1121B8F6A443A643e40951` | 24,009 B |
| `PositionManager` | `0x58daec3116aae6D93017bAAea7749052E8a04fA7` (`poolManager()` == above, checked) | 23,877 B |
| `Permit2` | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | 9,152 B |

### 4.3 USDG (quote asset) — Paxos-native, freeze **and wipe**

RH-mainnet USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` — 6 dp, EIP-1967 **UUPS** proxy (impl
`0x68184C449E1a8f34fA18d289737129FD27B66f8F`, admin slot zero), `paused()`, `isFrozen(address)`, AccessControl;
matches Paxos' published RH-mainnet row. Verified 2026-09-07 (M-07) — **native Paxos issuance, not an Arbitrum-bridged
token**; the LayerZero OFT wrapper is transport only. `ASSET_PROTECTION_ROLE` can freeze **and `wipeFrozenAddress`** —
a wipe of the PM / staging / adapter / Morpho-vault address is a permanent loss (disclosed on `/legal` and
`/risk-disclosures`; accepted; the reason exposure stays bounded). Fee-on-transfer would *revert* deposits
(`stage` pulls exactly `quoteAmount`), not mis-mint. Not yet done: byte-for-byte compare of the RH implementation
against the Ethereum-mainnet USDG implementation (public ETH RPCs unreachable from the audit host) — an optional ask.

### 4.4 Current testnet rig ("rig e", the close-out redeploy) — `config/deployments.json` → `testnet.robinhood-testnet`, verified 2026-09-08

| Contract | Address (46630) | Note |
|---|---|---|
| `LpGatewayPositionManager` | `0x259a9f1cdcf8d2172964d151366b2c7c9ea6f442` | owner + `harvestRecipient` = gateway seat `0x18AE…663c`, band 500 bps. Has every close-out change (C-10 tolerant read, timelocked rotation, factory binding checks, adapter Ownable2Step). Smoke passed 2026-09-08. |
| `LpGatewayStaging` | `0x24f69ca370e85e7f18799161bc6b0267d6ac00cc` | controller = PM; deployer = gateway seat |
| `LpGateway_ERC4626YieldAdapter` | `0xd6866f00684b2ea1219bc6d91caf61dbd591bc94` | **production** adapter, `vault` = staging (set once), uncapped |
| `LpGateway_MockERC4626YieldSource` | `0x804ae0d2fa81ab9cafe12b1a60e88bdbe201ac72` | OZ ERC4626 over tUSDG — stands in for Morpho |
| `LpGateway_tUSDG` / `LpGateway_tPONS` | `0xd2af3d6e58d0caec184548e465e10fa63968ebfd` / `0x4b60b01014227795b660c105e38993104ec4a629` | mock 6 dp / 18 dp, no value; fresh hookless pool initialised at price 1.0 |

Deployed **directly** (not via the factory) by the pure-Privy script; the factory is exercised in unit tests only.
Prior rigs (`0xbb2c…91f3` 'd', `0x24ff…3b11` 'c', `0xd488…b53e`, `0x39B8…BD2a`) are superseded. ⚠ The generated
`AUTO` block in `.claude/STATE.md` still lists rig 'd' — `config/deployments.json` is the source of truth; run
`pnpm context:sync` to reconcile.

### 4.5 Mainnet: nothing deployed. Candidate inputs that passed the read-only preflight (2026-09-08)

Pool PONS/USDG 0.30 % / spacing 60, hookless, poolId `0x4be9657ec9002e528f4f17a5c43edc525a07f888f7b180c2afbf75e096c4f38a`
(PONS `0x39dBED3a2bd333467115dE45665cC57F813C4571`, 18 dp; USDG = currency1; in-range `L ≈ 1.62e19`, virtual USDG
reserve ≈ 14.0 M, ±2 % depth ≈ 139 k USDG). Source: Morpho **Steakhouse USDG** `0xBeEff033F34C046626B8D0A041844C5d1A5409dd`
(≈ 443 M USDG; **`maxDeposit == 0` on 2026-09-08** — supply cap full, blocks deployment). Full 41-row table:
[`lp-gateway-mainnet-runbook.md`](lp-gateway-mainnet-runbook.md) §2. Curation rules the firm should treat as
*preconditions* of the threat model: [`lp-gateway-pool-curation-policy.md`](lp-gateway-pool-curation-policy.md).

---

## 5. Prior work — verify, do not redo

Three internal rounds, all with remediation merged and regression-tested. The firm should **read the reports,
re-run the PoCs, and confirm each fix is complete** rather than rediscover the findings.

| Round | Date | Report | Findings (contract layer) | PoC suite |
|---|---|---|---|---|
| **1 · Self-audit + firm-grade multi-auditor review** | 2026-09-06/07 | [`lp-gateway-v1-audit.md`](lp-gateway-v1-audit.md), [`lp-gateway-v1-security-review.md`](lp-gateway-v1-security-review.md) | C-01 (off-chain curator bearer), H-01 (registry), **H-02** fee leak on modify, **H-03** cross-block spot-NAV, M-01…M-07, L-01…L-09, I-01/I-02 | `test/fork/MintwareLpGatewayHardeningFork.t.sol` (7) |
| **2 · Real-funds re-audit** (three passes, reconciled) | 2026-09-07 | [`lp-gateway-v1-realfunds-audit-findings.md`](lp-gateway-v1-realfunds-audit-findings.md) (+ pack: [`lp-gateway-v1-realfunds-audit-pack.md`](lp-gateway-v1-realfunds-audit-pack.md)) | **A-1** under-delivery strands value · **A-2** empty-position brick · **A-3** unbounded/unpriced deploy · A-4 ledger (off-chain) · A-5 mock adapter drainable · A-6 hooked pools · A-7 registry · A-8/A-9 DOA + info; USDG M-07 verification | `test/gateway/MintwareLpGatewayRealAdapter.t.sol` (11), A-1 unit PoC, fork A-1/A-2/A-3 in Hardening suite |
| **3 · Hacken-style + red team** (four passes) | 2026-09-08 | [`audits/2026-09-08-consolidated.md`](audits/2026-09-08-consolidated.md); per-pass: [`hacken-style-contracts`](audits/2026-09-08-hacken-style-contracts.md), [`hacken-style-offchain`](audits/2026-09-08-hacken-style-offchain.md), [`redteam-onchain`](audits/2026-09-08-redteam-onchain.md), [`redteam-offchain`](audits/2026-09-08-redteam-offchain.md) | **C-1** withdraw mark under-pays · **C-2** third-party token freezes idle · **C-3** cap on marked value · C-4 spot re-read · C-5 LP-sourced shortfall · C-6 no slippage bounds · C-7 stale follower · C-8 docs · C-9 adapter ownership/binding · C-10 reverting source · C-11 L1 block; off-chain **O-1…O-14** | `test/audit/HackenContracts.t.sol` (16), `test/audit/RedTeamOnchain{Fork,Unit}.t.sol` (22 + 12), `test/fork/MintwareLpGatewayAuditRound2Fork.t.sol` (10) |
| **Close-out** | 2026-09-08 | [`audits/closeout/README.md`](audits/closeout/README.md) + [`contracts-residuals.md`](audits/closeout/contracts-residuals.md), [`mainnet-path.md`](audits/closeout/mainnet-path.md), [`registry-ledger.md`](audits/closeout/registry-ledger.md), [`ui-money-path.md`](audits/closeout/ui-money-path.md), [`discovery-hygiene.md`](audits/closeout/discovery-hygiene.md), [`offchain-pocs-flipped.md`](audits/closeout/offchain-pocs-flipped.md) | C-9a/b, C-10, 48 h recipient rotation; O-1…O-5, O-7…O-14 fixed; **O-6 open** (Privy credential separation) | `test/fork/MintwareLpGatewayCloseoutFork.t.sol` (5), `test/gateway/MintwareLpGatewaySourceOutage.t.sol` (5) |

Superseded claims to be aware of (each round amended the previous): round-1 "M-03 fixed" (cron passed
`minLiquidity = 0`), "withdrawals never brick" (held only while the adapter served and the LP was non-empty),
"capped deploy fraction" (did not exist until A-3), and the round-1 withdraw-side `min(spot, ref)` mark (retired in
round 2 as harmful under pro-rata sourcing, C-1). The current design is the one in §1.

### 5.1 Running the PoC suites (exact commands, from the repo root)

```bash
export PATH="$HOME/.foundry/bin:$PATH"
git submodule update --init --recursive          # v4-core, v4-periphery (+ permit2), OZ, forge-std

# 1. Full non-fork suite (what CI step 1 runs; fork harnesses self-skip without an RPC)
forge test -vv

# 2. Gateway unit + adapter suites only (no RPC)
forge test -vv --match-contract 'MintwareLpGateway(Factory|PositionManager|RealAdapter|SourceOutage|Staging)Test|MintwareERC4626YieldAdapter|RedTeamOnchainUnitTest|HackenLpGatewayUnitTest'

# 3. Fork suites against the live Robinhood testnet v4 stack (real PoolSwapTest swaps; the audit PoCs)
LP_FORK_RPC_URL=https://rpc.testnet.chain.robinhood.com \
  forge test -vv --match-contract 'MintwareLpGateway(Hardening|AuditRound2|Closeout)Fork|RedTeamOnchainFork|HackenLpGateway'

# 4. Deep fuzz/invariant budget (512 × 1000 invariant, 1024 fuzz)
FOUNDRY_PROFILE=deep forge test -vv --match-path 'contracts-v4/test/gateway/*'

# 5. Storage layout (the red-team fork probe reads _refSqrtPrice at slot 7 via vm.load — must not move)
forge inspect MintwareLpGatewayPositionManager storage-layout

# 6. Sizes
forge build --sizes | grep -E 'MintwareLpGateway|MintwareERC4626'

# 7. Off-chain (Module B) — Vitest, gateway + audit PoCs
pnpm vitest run lib/gateway
```

Notes: `MintwareLpGatewayForkTest` (the operator-runbook harness, 1 test) needs the live rig's `LP_QUOTE_ASSET` etc.
and is excluded from the CI pattern. If the firm's shell has the repo's RTK hook active, wrap commands in
`bash -c '…'` (the hook reformats forge output). CI (`.github/workflows/ci.yml`, job `forge-tests`) runs steps 1 and
3 with an RPC preflight and a 3-attempt retry; a `[FAIL]` fails the job.

Last recorded full-repo result (close-out, `contracts-residuals.md`): **869 pass / 0 fail / 4 skip** (no RPC) and
**60 / 0** for the fork pattern with RPC. `forge test --list --json` on `23586164` enumerates **933 test functions
across 98 test contracts in 91 files** (the four `contracts-v4/test/fork/` mainnet harnesses self-skip without
`BASE_RPC_URL`; they are out of scope).

### 5.2 Storage layout of the PM (from `forge inspect`, recorded in the close-out)

| Slot | Variable |
|---|---|
| 0 / 1 | `_owner` / `_pendingOwner` (Ownable2Step) |
| 2–4 | `_poolKey` |
| 5 | `tokenId` |
| 6 | `deployedPrincipal` |
| **7** | `_refSqrtPrice` (uint160) + `_refBlock` (uint64) — **fork-probe target** |
| 8 / 9 / 10 | `_lastActionBlock` / `sharesOf` / `totalShares` |
| 11 | `paused` (bool) + `harvestRecipient` (address) |
| 12 | `pendingHarvestRecipient` + `harvestRecipientEta` (uint64) |
| 13 | `lastKnownIdle` |

---

## 6. Invariants and properties we want proven or broken

Each is stated so it can be encoded as a Forge invariant/fuzz property or attacked with a fork PoC. "Value" is
quote-asset terms at a fixed price unless stated.

**Share accounting and exit**

1. **Pro-rata exit is price-neutral.** For any `shares ≤ sharesOf[u]` and any spot `p`, `_withdraw` requests exactly
   `f·idle` and `f·liquidity` with `f = (shares + f·VIRTUAL-share) / (totalShares + VIRTUAL)` per `SeniorSharesMath.toAssets`;
   the *size* of the LP slice (liquidity units) is independent of `p`; only its token composition varies. No price
   read occurs before `liqToRemove` is fixed except the single cached `spot` used as a re-credit weight.
2. **Re-credit never mints value.** After any withdrawal, `sharesBurned ≤ shares` and
   `reCredit = shares·(claim − delivered)/claim` with `delivered ≤ claim`; a withdrawer's post-exit claim
   (`sharesOf·NAV/totalShares`) never exceeds their pre-exit claim minus what was delivered, at the cached spot.
   Attack surface: manipulating `delivered` (paired leg valued at cached `spot` via `_pairedToQuote`) or `claim`.
3. **Last-holder clean state.** When `shares == totalShares`, the exit removes *all* liquidity and all idle (minus
   what the source withholds), leaving `deployedPrincipal == 0` and a position with `liquidity == 0` that `deploy`,
   `harvest`, and a fresh `deposit` can all recover from (A-2). Offset dust is bounded by `VIRTUAL` (~$1 at 6 dp).
4. **Share-inflation defense.** With `VIRTUAL = 1e6` on both sides, a first-depositor donation of `D` to the
   staging/adapter/source can extract at most ~`D/VIRTUAL`-scale from a victim; an ERC-20 donation to the
   *adapter* cannot change `totalAssets` (it reads `previewRedeem(balanceOf(this))`); rounding (`Floor` on mint and
   redeem) never favours the caller across repeated dust cycles (RT-1g).
5. **Fee-net entry vs par mint (L-05 residual).** A depositor is credited on `quoteAmount` while NAV rises by
   `quoteAmount·(1 − sourceFee)`. Quantify the maximum dilution of prior holders for a source exit fee `φ`; confirm it
   is one-directional and bounded, or propose pricing the mint on the NAV delta.

**Deploy cap and follower**

6. **Cost-basis cap is monotone and un-reopenable.** `deployedPrincipal` increases only in `deploy` (by the quote
   actually used), decreases only in `_withdraw` (pro-rata by burned shares), never with price. Invariant:
   `deployedPrincipal + quoteToDeploy ≤ 0.5·(stagedAssets + deployedPrincipal)` at every successful `deploy`,
   including after a drawdown (RT-9a), a source-yield jump, or the owner's own paired-leg subsidy.
7. **Follower band bounds.** `_refSqrtPrice` moves at most `ref·maxDeviationBps/10_000` per `block.number`
   (L1 block), in the direction of spot, only once per block, and never reverts; `deploy` reverts
   `DeployPriceOutOfBand` whenever `|spot − ref| > band` once a reference exists; no function (owner or not) can set
   the reference to an arbitrary value (`pokePrice` was removed). `poke()` adds no capability a dust deposit lacked.
8. **Entry mark is conservative.** `_navDepositStrict` values the LP leg at `max(valueAt(spot), valueAt(ref))`; a
   same-block dump cannot cheapen entry; `depositWithMin` bounds a pump. Property: for any single-block spot
   manipulation `p' ≠ p`, `sharesMinted(p') ≤ sharesMinted(p_ref)`.

**Availability under third-party failure**

9. **Withdrawals never revert for third-party token or source failures.** For any paired token that reverts/pauses/
   blacklists on transfer or has transfer hooks, any `harvestRecipient` frozen by the quote issuer, any 4626 source
   whose `previewRedeem`/`redeem`/`maxRedeem` reverts or returns 0: `withdraw` still succeeds, delivers whatever leg
   is deliverable, re-credits the rest, and burns only `shares·delivered/claim` (C-2, C-5, C-10, RT-6a/b/c, RT-5f).
   The one deliberate refusal: source unreadable **and** `liqToRemove == 0` → `SourceUnavailable` with state
   untouched. Reentrancy from any of those callbacks (source `redeem`, paired-token hook) into `deposit`/`withdraw`/
   `lpLegExit` must be blocked (`nonReentrant` + `NotSelf`).
10. **H-02 fee ordering.** On every path that changes position liquidity (`lpLegExit` before `_decreaseAndTake`;
    `deploy` before `_increaseCalls`), `_sweepFees` runs first, so accrued fees reach `harvestRecipient` and never a
    withdrawer or the re-stage. Property on a fork with real swaps: `withdrawer_out == principal slice` and
    `Δrecipient == accrued fees`, for partial and full exits, including when `_sweepFees` early-returns at zero liquidity.
11. **`lastKnownIdle` is conservative.** During a source outage the idle entitlement is sized off the last
    successful read; yield accrued since is invisible, so a withdrawer burns *more* shares per unit delivered, never
    fewer; no path lets a stale `lastKnownIdle` *over*-state idle relative to the live reserve after the source returns.

**Access control and one-way switches**

12. **Timelocked recipient rotation.** `harvestRecipient` changes only via `proposeHarvestRecipient` →
    ≥ 48 h → `acceptHarvestRecipient`, all owner-only; every sweep during the window pays the *current* recipient;
    `cancel` and re-propose behave as documented; the pending owner (Ownable2Step) has no power until `acceptOwnership`.
13. **One-time `setVault` / `setController`.** Adapter `setVault` is owner-only and reverts once set (including across
    an ownership handoff); staging `setController` is deployer-only and one-way; no deploy/factory path leaves a
    window where a third party can claim either seat (RT-7a).
14. **Permit2 hygiene.** After every `deploy`, the Permit2 allowance `(token → PositionManager)` is 0 for both tokens
    (`_revokePermit`), the residual ERC-20 allowance to Permit2 is inert, and a reverted `modifyLiquidities` rolls back
    the approvals. Only the PM's own tokens can be spent by the official PositionManager on its behalf.
15. **Owner cannot extract principal.** Enumerate every owner-reachable state transition (`deploy`, `harvest`,
    `compoundQuote`, `setPaused`, rotation, `setPerBlockWithdrawCap` on the adapter, `createGateway`/`deactivate`) and
    show none moves depositor principal to an owner-controlled address other than via AMM economics bounded by the
    50 % cost-basis cap and the follower band (RT-9b/9c/9d). Quantify the worst case for a compromised seat.
16. **Value conservation at 6 dp × 18 dp.** For the real decimal pairing (USDG 6 dp quote, 18 dp paired), NAV, exit
    amounts and re-credits round in the contract's favour and never create value; `_pairedToQuote` does not overflow
    for realistic `sqrtPriceX96 × amount` (RT-x).

---

## 7. Known residuals and accepted risks (focus elsewhere)

| Residual | Status | Where documented |
|---|---|---|
| **Patient cross-block manipulation on a thin pool** (H-03 / RT-1e / C-6) — the follower bounds per-block movement; over many blocks it is capital-expensive, not impossible | Accepted; controlled by curation (min depth R5, max gateway share R8), `depositWithMin`/`withdrawWithMin`, the deploy cap | policy §6, consolidated §4 |
| **Paired-token admin controls** (pause/blacklist/upgrade/hooks) can freeze the LP leg until the third party relents; funds are re-credited, not lost | Accepted; excluded by policy R4 + two-person review; `LpLegUnavailable` monitored | policy §2/§6, runbook §7/§9 |
| **USDG issuer freeze / wipe** (M-07) — a wipe of a holder-at-rest is permanent loss | Accepted; disclosed; exposure bounded | realfunds §2/§8, `/legal`, `/risk-disclosures` |
| **Adapter `perBlockWithdrawCap`** is an instant, unbounded owner lever (delay, not loss — A-1 re-credits) | Accepted (same seat as PM owner); follow-up: floor or timelock decreases before third-party funds | closeout `contracts-residuals.md` C-9a |
| **`lastKnownIdle` staleness** during an outage under-pays the withdrawer marginally (conservative direction) | Accepted | closeout C-10 residual |
| **Recipient rotation is owner-accepted, not recipient-accepted**; a frozen recipient still blocks `harvest`/`deploy` for up to 48 h | Accepted by design (the window *is* the safety margin) | closeout rotation residual |
| **Owner paired-leg contribution is a depositor subsidy** (every deploy adds owner capital to depositor NAV); fine for own funds, an accounting hole for third-party depositors | Open design question (A-9 / red-team §5.3) — **please opine** | redteam-onchain §5 |
| **Reverting-preview 4626 source** (C-10) tolerated on withdraw, refused on deposit/deploy | Accepted; source = Morpho only (R6) | closeout C-10 |
| **Factory 945 B under EIP-170**; live rig was deployed directly, not via the factory | Known; next PM feature needs a deployer split | closeout "Bytecode size" |
| **Fee-net entry vs par mint** (L-05), **`DECREASE` with `amount0Min = amount1Min = 0`** (L-01; user floor is `withdrawWithMin` instead) | Accepted lows | security-review remediation table |
| **Single Privy `PRIVY_APP_SECRET` reaches both `root` and `gateway` wallets** (O-6) — separation is address-level today | **Open**, human step (Privy authorization keys / per-wallet policies) | closeout README §"Left for a human" |
| **Off-chain**: A-4/O-4 fee ledger rebuilt (event-indexed, on-chain-share-weighted) but `LP_GATEWAY_HARVEST_DESTINATION=restake` is mandatory on mainnet; buffer-credit path never enabled | Fixed + policy | closeout `registry-ledger.md` |
| Hardhat/campaign/RWA surfaces referenced in older rules | Removed / shelved — ignore | `.claude/STATE.md` |

---

## 8. Specific questions for the auditor

**Economic**

1. **Follower speed vs block cadence.** `maxDeviationBps = 500` is 5 % of √price per L1 block (≈ 10 % price/block).
   With Robinhood Chain's `block.number` = L1 block (~12 s), is a bound per *block* the right primitive, or should
   the step be per *elapsed time* (`block.timestamp`)? Model the cost, in USDG and blocks, for an attacker to walk
   the reference by 2× on the reference pool (§4.5 depth) and on a pool at the policy minimum (250 k USDG virtual
   reserve), versus the maximum extractable via (a) entry-mark cheapening for a deposit and (b) an in-band deploy
   sandwich. Recommend a band and, if warranted, a time-based variant.
2. **`MAX_DEPLOY_BPS = 5000` calibration.** Given IL exposure on a ±22 980-tick range (≈ −90 % / +10×), the
   owner-subsidised paired leg, and the RT-9 drawdown-cycle attack (now closed by the cost-basis base), is 50 % of
   principal at cost the right constant? Should the cap also bound the *paired* leg or total LP value relative to NAV
   (Hacken F-03 showed a balanced deploy is ~66.7 % of NAV)? Is a constant preferable to an owner-timelocked parameter?
3. **Thin-pool manipulation cost model.** Produce a closed-form or simulated model: attacker capital `K`, pool
   in-range liquidity `L`, gateway share `s` of pool USDG, fee tier `φ`, band `b`, blocks `n` → maximum extraction from
   co-depositors via the deposit-side mark and the deploy band. Validate the policy thresholds (R5 depth ≥ 250 k USDG,
   R8 gateway share ≤ 2 % at deploy / 5 % running) and tell us where they are wrong.
4. **Pro-rata exit composition risk.** With pure pro-rata sourcing the withdrawer receives a paired-token slice at
   whatever spot rules; is there a residual sandwich the `withdrawWithMin` floors do not cover (e.g. via the re-credit
   weight)? RT-1b/1c/1d failed against the current code — try harder.
5. **Owner-subsidy accounting** (§7): should the owner's paired leg be tracked as a separate claim (owner shares)
   before third-party depositors are admitted, and what is the cleanest on-chain shape?

**Operational / key management**

6. **Privy seat separation.** The PM owner, adapter owner, factory owner and `harvestRecipient` are one Privy
   server-wallet (`gateway`, `0x18AE…663c`), distinct at the *address* level from the card/x402 `root` seat
   (`0x7fD8…7E06`), but both are reachable with one `PRIVY_APP_SECRET`. Assess: (a) is address-level separation
   plus Privy authorization keys / per-wallet policies sufficient, or should the owner be a multisig / timelock with
   the Privy seat as a bounded operator; (b) which owner functions warrant a second signer (`deploy` size,
   `setPerBlockWithdrawCap`, `acceptHarvestRecipient`, `createGateway`); (c) the incident playbook
   (runbook §9) for seat compromise — is `transferOwnership` from a compromised seat a race we can win?
7. **Deployed-periphery equivalence.** Diff the deployed RH `PositionManager`/`PoolManager` bytecode against the
   vendored commits for the five actions used and `getPositionLiquidity`/`nextTokenId`/`poolKeys`.
8. **USDG implementation equivalence.** If feasible from your infrastructure, compare the RH-mainnet USDG
   implementation to the Ethereum-mainnet one (the item we could not complete).
9. **Upgrade path.** All contracts are immutable; the only "upgrade" is a new instance per pool via the factory and
   registry retirement. Is there a migration risk we have not considered (e.g. users of a retired instance)?

---

## 9. Deliverables, severity scale, timeline, communications

### 9.1 Deliverables

1. **Kick-off scoping note** (day 1–2): confirmation of the freeze SHA, build reproduction (`forge build` sizes and
   `forge test` results match §5), any scope questions.
2. **Preliminary findings report** with per-finding: ID, severity, likelihood/impact rationale, affected
   file:line at the freeze SHA, PoC (as a Forge test we can commit under `contracts-v4/test/audit/external/`), and
   a recommended fix. Verified PoCs preferred over prose (our internal rounds set that bar: nothing speculative).
3. **Property/invariant work product**: for §6 items the firm proves, the harness (Forge invariant/fuzz, or
   Halmos/Certora if used) committed to the repo; for items the firm breaks, the PoC.
4. **Fix-review pass** on our remediation commit(s): each finding marked Fixed / Partially fixed / Acknowledged /
   Not fixed with the verifying test named.
5. **Final report**, publishable, with the freeze SHA and the fix-review SHA, the full test/PoC inventory, and an
   explicit statement of what was *not* covered (Module B if not purchased, deployed-periphery diff if not done).
6. Optional: a one-page **economic memo** answering §8 Q1–Q3 with the model and parameters.

### 9.2 Severity scale we expect (Hacken / Trail of Bits style)

| Severity | Definition |
|---|---|
| **Critical** | Direct loss or theft of depositor principal or fees by an unprivileged party, or by the owner beyond the documented bounds; permanent freeze of depositor funds; share-inflation or accounting error that mints value. No preconditions beyond public access. |
| **High** | Same outcomes but requiring specific preconditions (thin pool, a specific token behaviour, a timing window, curator/owner error), or a bounded-but-material economic extraction (> the attacker's cost); withdrawals bricked for a class of depositors. |
| **Medium** | Loss bounded to a small fraction / to rounding-scale, temporary DoS of a money path, griefing that costs the operator, invariants that hold only under assumptions not enforced on-chain, incorrect but recoverable state. |
| **Low** | Best-practice deviations with no realistic loss path, gas, edge-case reverts, missing events, defensive checks. |
| **Informational** | Documentation/code mismatches, clarity, test-coverage gaps. |

Please rate **likelihood** and **impact** separately and state the *precondition set* explicitly (e.g. "requires an
admin-controlled paired token, excluded by policy R4") so we can map each finding onto the curation policy versus
a code change.

### 9.3 Timeline (our expectation — the firm should confirm against §2.2 size and §6 scope)

| Phase | Indicative duration |
|---|---|
| Scoping + build reproduction | 2 days |
| Module A review (1,230 LOC + ≈ 4,740 LOC of gateway tests/PoCs to read — `wc -l` over A.1–A.4 files; fork infra provided) | 2–3 weeks, two auditors |
| Module B (optional, off-chain money path ≈ 3.5 k LOC TypeScript + 7 migrations) | +1 week |
| Our remediation window | ≤ 1 week after the preliminary report |
| Fix review + final report | 3–5 days |

Gate: **no third-party funds until the final report is delivered and every Critical/High is Fixed** (not
Acknowledged). Bounded own-funds rollout may proceed in parallel per the runbook (§8 there), which the audit does
not unlock beyond its step 2.

### 9.4 Communications

- Repository access: private GitHub `MintwareDevelopers/Mintware-Beta`, read access to the freeze tag plus a
  `audit/external-*` branch for the firm's PoCs. Public testnet RPC needs no credentials; we will keep the testnet
  rig (§4.4) live for the engagement and can fund test wallets with mock tUSDG/tPONS on request.
- A shared channel (Slack Connect or Telegram) for questions; a weekly 30-min sync; findings that are
  **Critical/High** disclosed immediately, not held for the report.
- Point of contact on our side: the operator of the `gateway` seat (Nic Robinson). Never share secrets over the
  channel; the firm never needs a private key — everything is reproducible on a fork or the public testnet.
- Disclosure: the final report is intended to be published (linked from `/legal` and the docs); the firm may name
  itself. We will not describe the engagement as a "certification".

---

## Appendix A — Test and PoC inventory (measured on `23586164` with `forge test --list`)

### A.1 Gateway unit suites (no RPC) — `contracts-v4/test/gateway/`, 61 tests

| File | Contract | # | Tests |
|---|---|---|---|
| `MintwareLpGatewayFactory.t.sol` | `MintwareLpGatewayFactoryTest` | 13 | `createGateway_isolatedInstance`, `_onlyOwner`, `_duplicateReverts`, `_adapterReuse_reverts`, `_zeroBand_usesDefault`, `twoPools_isolated`, `adapterBinding_productionAdapter_matchingAsset_passes`, `_wrongAsset_reverts`, `_legacyAdapter_noAssetGetter_fallsBackToTotalAssets`, `_notAnAdapter_reverts`, `_eoa_reverts`, `_vaultAlreadyWired_reverts`, `deactivate` |
| `MintwareLpGatewayPositionManager.t.sol` | `MintwareLpGatewayPositionManagerTest` | 24 | `firstDeposit_oneToOne`, `secondDeposit_pricedAtNav`, `withdraw_idle_returnsValue`, `inflationDefense_secondDepositorWhole`, `deploy_onlyOwner`, `harvest_onlyOwner`, `harvest_revertsWhenUndeployed`, `withdraw_moreThanBalance_reverts`, `harvestRecipient_setAtConstruction`, `harvestRecipientRotation_{happyPath_after48h,earlyAccept_reverts,cancel,reproposeRestartsClock,guards}`, `lastKnownIdle_tracksReserve`, `sameBlock_depositThenWithdraw_reverts`, `sameBlock_twoDeposits_reverts`, `maxDeviationBps_set`, `renounceOwnership_disabled`, `pause_blocksDeposit_allowsWithdraw`, `setPaused_onlyOwner`, `compoundQuote_liftsNavNoMint`, `compoundQuote_onlyOwner`, `audit_A1_idleOnlyWithdraw_adapterIlliquid_reCreditsUnservedShares` |
| `MintwareLpGatewayRealAdapter.t.sol` | `MintwareLpGatewayRealAdapterTest` | 11 | `A5_deposit_routesIntoYieldSource`, `A5_withdraw_roundTrip`, `A5_sourceYield_liftsNav_secondDepositorPricedAtNav`, `A5_nonVaultCannotDrainAdapter`, `A5_strangerCannotRedeemAdapterShares`, `A5_setVault_oneTime_andOwnerOnly`, `A5_adapterRejectsWrongAssetSource`, `A5_factoryPath_depositsFailClosedUntilVaultWired`, `A5_A1_perBlockCap_reCreditsUnserved`, `A5_A1_stalledSource_servesZero_fullReCredit_thenRecovers`, `A5_feeChargingSource_navIsFeeNet` |
| `MintwareLpGatewaySourceOutage.t.sol` | `MintwareLpGatewaySourceOutageTest` | 5 | `C10_totalNav_fallsBackToLastKnownIdle_neverReverts`, `C10_deposit_revertsSourceUnavailable_noMint`, `C10_withdraw_idleOnly_refusesWithoutBurning_thenRecovers`, `C10_deploy_and_compound_failClosed`, `C10_lastKnownIdle_isLastSuccessfulRead` |
| `MintwareLpGatewayStaging.t.sol` | `MintwareLpGatewayStagingTest` | 8 | `setController_isOneWay`, `setController_onlyDeployer`, `stage_onlyController`, `stage_earnsFromDeposit`, `yield_accrues_to_staged`, `unstage_returns_principal_plus_yield`, `unstage_isBestEffort_underIlliquidity`, `unstage_onlyController` |

### A.2 Adapter suite (no RPC) — `contracts-v4/test/MintwareERC4626YieldAdapter.t.sol`, 17 tests

`MintwareERC4626YieldAdapterTest` (12): `deposit_supplies_and_tracks_assets`, `withdraw_returns_assets_to_vault`,
`yield_accrues_into_totalAssets`, `withdraw_is_best_effort_when_source_stalls`, `per_block_withdraw_cap_clamps`,
`maxSuppliable_reflects_source`, `only_vault_can_supply_and_withdraw`, `setVault_is_one_time`,
`ownership_twoStep_pendingOwnerPowerless_untilAccept`, `renounceOwnership_disabled`,
`setVault_stays_one_time_across_owner_handoff`, `constructor_rejects_asset_mismatch`.
`MintwareERC4626YieldAdapterFeeTest` (5): `fee_totalAssets_is_conservative_not_overreported`, `fee_maxWithdrawable_is_fee_net`,
`fee_withdraw_near_full_succeeds_via_redeem`, `fee_partial_withdraw_meets_request`, `fee_per_block_cap_clamps`.

### A.3 Fork suites (require `LP_FORK_RPC_URL`; real v4 stack on Robinhood testnet) — `contracts-v4/test/fork/`, 23 tests

| File | Contract | # | Tests |
|---|---|---|---|
| `MintwareLpGatewayHardeningFork.t.sol` | `MintwareLpGatewayHardeningForkTest` | 7 | `fork_H02_harvestSweepsFeesToRecipient`, `fork_H02_withdrawDoesNotLeakFees`, `fork_H03_conservativeMarkCapsPump`, `fork_A2_fullDrainThenHarvestAndRedeploySucceed`, `fork_A3_deployCapBlocksOverExposure`, `fork_A3_deployPriceBandBlocksSandwich`, `fork_A1_withdrawAdapterShort_reCreditsUnserved` |
| `MintwareLpGatewayAuditRound2Fork.t.sol` | `MintwareLpGatewayAuditRound2ForkTest` | 10 | `R2_F01a_soleHolderExitAfterStaleRally_nothingStranded`, `R2_F01b_remainingHolderPump_cannotExtract`, `R2_F02a_pairedTokenPaused_idleLegStillPays_lpReCredited`, `R2_F02b_harvestRecipientFrozen_withdrawStillPays`, `R2_RT5a_adapterShortfall_notSourcedFromLP`, `R2_RT9a_crashDoesNotReopenDeployCap`, `R2_RT1a_depositWithMin_blocksSandwich`, `R2_F04_poke_isPermissionlessAndBounded`, `R2_RT2_fullDelivery_noReCredit`, `R2_withdrawWithMin_reverts_whenBelowFloor` |
| `MintwareLpGatewayCloseoutFork.t.sol` | `MintwareLpGatewayCloseoutForkTest` | 5 | `CF_C10_partialExitDuringOutage_lpPays_idleReCredited_noLoss`, `CF_C10_lastHolderFullExitDuringOutage_nothingStranded`, `CF_C10_outageExit_doesNotTouchCoDepositor`, `CF_rotation_sweepsFollowRecipientOnlyAfterAccept`, `CF_rotation_recoversHarvestAfterRecipientFreeze` |
| `MintwareLpGatewayFork.t.sol` | `MintwareLpGatewayForkTest` | 1 | `fork_deposit_stagesAndMintsEntryNavShares` (operator harness against the live rig; needs `LP_QUOTE_ASSET` etc.; excluded from CI) |

### A.4 Audit PoC suites — `contracts-v4/test/audit/` (gateway-relevant), 50 tests

Naming convention: `_SUCCEEDS` = the attack worked against the pre-fix code and the test now documents the bound;
`_FAILS` = the attack is blocked (defense held); `_FIXED` = originally succeeded, re-shaped to assert the fix.

| File | Contract | RPC | # | Tests |
|---|---|---|---|---|
| `HackenContracts.t.sol` | `HackenLpGatewayUnitTest` | no | 5 | `VS_ctor_rejectsHookedPool`, `VS_ctor_rejectsNativeEthPair`, `VS_ctor_rejectsBadTicks`, `VS_ctor_rejectsBadBand`, `I03_leftoverNavAtZeroShares_recoveredByLastHolder_FIXED` |
| `HackenContracts.t.sol` | `HackenLpGatewayForkTest` | yes | 11 | `F01a_staleRefRally_soleHolderExitsWhole_noLeftover_FIXED`, `F01b_remainingHolderPump_withdrawerGetsExactProRata_FIXED`, `F01c_staleRefCrash_depositorOverpays`, `F02a_pairedTokenPaused_idlePaysAndLpSliceReCredited_FIXED`, `F02b_harvestRecipientFrozen_withdrawStillPays_FIXED`, `F03_deployCap_isQuoteLegOnly_exposureExceeds50pct`, `F04_staleRef_blocksDeploy_untilWalked`, `VS_permit2AllowanceRevokedAfterDeploy`, `VS_pairedTokenReentrancyBlocked`, `VS_withdrawAtDeflatedSpot_isExactlyProRata`, `VS_depositAtDeflatedSpot_notCheapened` |
| `RedTeamOnchainFork.t.sol` (+ `RedTeamOnchainTokens.sol` helper tokens: blacklist / pausable / hook / FoT / flaky 4626) | `RedTeamOnchainForkTest` | yes | 22 | `RT_1a_depositSandwich_thinPool_SUCCEEDS`, `RT_1a_depositSandwich_depositWithMin_blocks_FAILS`, `RT_1a_depositSandwich_deepPool10x_SUCCEEDS`, `RT_1e_heldPump_noMempool_dilutesLaterDeposit_SUCCEEDS`, `RT_1b_withdrawSandwich_dumpVictimPump_FAILS`, `RT_1c_twoAddressSameBlockRoundTrip_FAILS`, `RT_1d_followerWalk_pumpHoldWithdraw_FAILS`, `RT_2_hookPaired_reCreditAfterFullDelivery_FAILS`, `RT_2b_plainPaired_reCreditIsDustOnly_FAILS`, `RT_3a_deploySandwichWithinBand_marginal_SUCCEEDS`, `RT_3b_deployPriceBandDoS_cheapPerBlock_SUCCEEDS`, `RT_4_drainedPositionStaleFollower_recoverable_FAILS`, `RT_5a_sourcePaused_firstMoverTakesWholeLP_FAILS`, `RT_5c_overReportingSource_drainsLPFromCoDepositors_SUCCEEDS`, `RT_6a_blacklistPairedFreezesPM_allWithdrawsBrick_FAILS`, `RT_6b_blacklistHarvestRecipient_bricksExitsOnceFeesAccrue_FAILS`, `RT_6c_blacklistSingleDepositor_targetedFreeze_FAILS`, `RT_6d_feeOnTransferPaired_deployDOA_noLoss_FAILS`, `RT_9a_crashCycle_honestCron_bypassesTotalDeployCap_FAILS`, `RT_9b_crashCycle_compromisedOwner_worstCaseLoss_FAILS`, `RT_9c_ownerPumpWalkDeployDump_boundedLoss_SUCCEEDS`, `RT_x_6dpQuote18dpPaired_valueConserved_FAILS` |
| `RedTeamOnchainUnit.t.sol` | `RedTeamOnchainUnitTest` | no | 12 | `RT_1f_firstDepositorDonation_6dp_victimPricedFairly_FAILS`, `RT_1g_roundingDrain_dustCycles_FAILS`, `RT_5d_transientExitFee_mintsCheapShares_SUCCEEDS`, `RT_5e_sourceSupplyCap_depositDOS_noLoss_FAILS`, `RT_5f_sourcePreviewReverts_availabilityPreserved_FIXED`, `RT_5g_reentrancyFromSourceRedeem_FAILS`, `RT_5h_reentrancyDepositFromSourceRedeem_FAILS`, `RT_7d_adapterOwnerPerBlockCap_softLocksExits_SUCCEEDS`, `RT_7a_setControllerRace_FAILS`, `RT_7b_factoryAdapterReuse_and_curation_FAILS`, `RT_7c_ownable2Step_pendingOwnerPowerless_FAILS`, `RT_9d_compromisedOwnerIdleOnly_noPrincipalSweep_FAILS` |

Other files in `contracts-v4/test/audit/` (`EthSenior*`, `Suite*`, `RedTeamTrancheInflationRecall`) target the
out-of-scope YPN/ETH-senior stack.

**Totals for the gateway:** 61 unit + 17 adapter + 23 fork + 50 audit = **151 Forge tests**; with RPC the CI
pattern runs 60 (7 + 10 + 5 + 22 + 16). Whole repo: 933 listed / 98 contracts / 91 files.

### A.5 Off-chain (Module B) — Vitest, grep-counted `it(`/`test(` (approximate; `pnpm vitest run lib/gateway` prints the exact count)

`lib/gateway/*.test.ts` — 16 files, ~211 cases: `basisMath` 7 · `chainTruth` 6 · `curateAuth` 4 · `deploy` 10 ·
`discovery` 35 · `harvest` 8 · `harvestMath` 15 · `leaderboard` 8 · `ledger` 12 · `positionQuote` 15 ·
`positionReader` 5 · `registry` 38 · `riskScore` 12 · `routeInstance` 13 · `sparkline` 10 · `v4Math` 13.
`lib/gateway/__audit__/*.test.ts` — 8 PoC files, ~54 cases (flipped to assert post-fix behaviour, see
`audits/closeout/offchain-pocs-flipped.md`): `hackenOffchain` 12 · `redteamOffchainDiscovery` 6 · `…Harvest` 4 ·
`…Keys` 4 · `…PublicRoutes` 5 · `…Registry` 7 · `…Routing` 8 · `…SignedAuth` 8.

### A.6 Audit-evidence files (read in this order)

1. `.claude/STATE.md` (platform live/shelved map) → `.claude/rules/lp-gateway.md` (rule file; its status line predates the close-out — this document and `config/deployments.json` win)
2. `docs/developers/lp-gateway.md` — how it works
3. `docs/developers/lp-gateway-v1-audit.md` → `lp-gateway-v1-security-review.md` (round 1, with remediation tables)
4. `docs/developers/lp-gateway-v1-realfunds-audit-pack.md` → `lp-gateway-v1-realfunds-audit-findings.md` (round 2)
5. `docs/developers/audits/2026-09-08-hacken-style-contracts.md`, `2026-09-08-redteam-onchain.md`, (off-chain: `2026-09-08-hacken-style-offchain.md`, `2026-09-08-redteam-offchain.md`) → `2026-09-08-consolidated.md` (round 3)
6. `docs/developers/audits/closeout/README.md` + `contracts-residuals.md` (storage layout, CI, size), `mainnet-path.md`, `registry-ledger.md`, `ui-money-path.md`, `discovery-hygiene.md`, `profile-leaderboard.md`, `offchain-pocs-flipped.md`
7. `docs/developers/lp-gateway-pool-curation-policy.md`, `lp-gateway-mainnet-runbook.md`, `lp-gateway-testnet-runbook.md`
8. `config/deployments.json` (deploy truth), `scripts/preflight-lp-gateway-mainnet.mjs`, `scripts/deploy-lp-gateway-{robinhood,mainnet}.mjs`, `scripts/smoke-lp-gateway-robinhood.mjs`
9. `.github/workflows/ci.yml` (`forge-tests` job), `foundry.toml`
10. Public copy that constrains claims: `app/legal/page.tsx`, `app/risk-disclosures/page.tsx`
