# YPN v2 — Treasury-Anchored ULV (`MintwareTreasuryVault`)

> The structured-tranche vault behind `IYieldVault`. Community USDC is a **senior, par-backed,
> card-spendable** claim; the team's locked native reserve is the **junior, first-loss** tranche
> that absorbs price + IL. Same `IYieldVault` seam as v1 → **zero Gateway change**.

Status: spec (2026-08-13). Stacked on: `feat/ypn-v1-foundation` (PR #215). Builds on:
`MintwareYieldVault` (v1, the reference `IYieldVault` impl — lift its senior share math),
`MintwareMatchedLiquidityVault` (accounting/lock/match base), `AaveV3YieldAdapter` (idle engine,
behind `IYieldAdapter`), `IYieldVault` (the payment seam v2 implements natively).

---

## 1. Why a tranche vault (the crux)

The community must hold a claim that is (a) USDC-denominated, (b) par + yield, (c) **price-free** —
so it is card-spendable at Visa with no pool-volatility exposure. But the capital is deployed as
2-sided LP (community USDC + team token), which *does* carry IL/MTM. Reconciling these is the whole
contract:

> **The senior counts its LP portion at PAR (the USDC deposited), never mark-to-market. The junior
> absorbs the LP's IL/MTM.**

```
seniorClaim  = communityPrincipal + accruedSeniorYield        (USDC, par — NO pool price)
juniorValue  = totalVaultValue − seniorClaim                  (residual — ALL MTM lives here)
```

The community's NAV moves *only* with realized USDC yield (Aave interest + credited fees). The pool
price never enters `previewWithdraw`/`burnForPayment`. The team's junior tranche eats the volatility.
That is what makes the money price-free — the tranche waterfall, on-chain.

---

## 2. Tranches & share classes

| | Senior — community | Junior — team/treasury |
|---|---|---|
| Asset in | single-sided USDC | native token reserve (meme/utility OR ETH/AAVE/etc.) |
| Claim | USDC, par + yield, **price-free** | residual equity, MTM |
| Loss order | paid **first** (before junior) | **first-loss** (absorbs price + IL) |
| Liquidity | **free + spendable** (YPN) | **locked** >= 90d hard cliff |
| Shares | `seniorShares` (implements `IYieldVault`) | `juniorShares` (redeem post-lock) |
| Yield during lock | Aave interest **+ 100% of LP fees/MEV** | none (excluded from fee denom — reuse `teamFeesRedirected`) |
| Yield post-lock | Aave interest + community 60/30/10 LP share | team 60/30/10 LP share + residual |

Senior share accounting is exactly v1's `MintwareYieldVault` math — symmetric virtual offset
(`VIRTUAL = 1e3`) inflation defense, mint-DOWN on deposit, `previewWithdraw` ceils so a burn always
frees >= requested USDC. **We lift that math verbatim** — it is already fuzz-proven.

---

## 3. Capital deployment (the engine)

```
community USDC in -+- idleBufferTargetBps (default 8000 = 80%) -> Aave (senior backing, par, spendable)
                   +- (1 - target)         (default 2000 = 20%) -> V4 LP, paired with team token
team token in --------------------------------------------------> V4 LP (the other side) + locked reserve
```

- `idleBufferTargetBps` — per-vault governable (blue-chips -> 7000/3000, 6000/4000). Bounded
  `[MIN=5000, MAX=9500]`; below 50% the senior can't be reliably par-served, above 95% there's no depth.
- Aave via the existing `AaveV3YieldAdapter` (`IYieldAdapter` seam — swap to Arc's yield primitive
  later, zero vault rewrite). Interest accrues to the senior.
- The LP: **v2-first ships a single managed V4 position** (mirrors `MintwareMatchedLiquidityVault`
  `activate()` — one range, team-locked-half / community-half). The full JIT/surge engine
  (`MWJitLib`/`MWHookCoordinator`) **composes in a follow-up** onto proven tranche solvency — NOT
  tangled into this build. The seam: the LP is reached only through `_deployToLP`/`_recoverFromLP`
  internal fns, so the JIT hook slots behind them later.

### Fee routing (locked economics)
- During the 90-day lock: **100% of LP fees/MEV -> senior** (`accruedSeniorYield += feesUSDC`). Reuse
  `teamFeesRedirected` — the team is excluded from the fee denominator while locked. Fallback if a
  fee sink is contended: 90/10 community/protocol.
- Post-lock: the standard 60/30/10 (community LP share / team LP share / protocol) applies; the
  community's 60 credits senior yield, team's 30 credits junior.

---

## 4. Senior par-redemption (the `IYieldVault` surface)

The Gateway calls these — identical signatures to v1, so **no Gateway change**:

```solidity
function idleBuffer() external view returns (uint256);
function previewWithdraw(uint256 assets) external view returns (uint256 shares);   // rounds UP
function burnForPayment(address user, uint256 shares, address receiver) external returns (uint256); // onlyGateway
```

- `idleBuffer()` = senior USDC redeemable **right now at par** =
  `min(seniorClaimRemaining, aaveBuffer.onHand + adapter.maxWithdrawable() + recoverableLP_USDC)`.
  In practice ~ the Aave buffer (80%), which is why spends clear instantly.
- `burnForPayment` waterfall for `need` USDC:
  1. take from USDC on hand,
  2. `adapter.withdraw(need - onHand)` from Aave (best-effort),
  3. only if still short, `_recoverFromLP(shortfall)` — unwind LP to USDC; **the junior eats any IL
     on the unwind** (recovered < par -> `juniorValue` absorbs it; senior still gets its par USDC).
  4. `require(balance >= need)` — else revert (never under-serve the senior).
- CEI: burn senior shares + debit `seniorClaim` **before** the external USDC transfer to `receiver`.
  No custody — USDC flows vault -> rail directly (same as v1).

---

## 5. The solvency invariant (the proof obligation)

The single property the whole design rests on — fuzz to **256 runs x 128,000 calls**, 0 reverts:

```
invariant_senior_par:
    seniorClaim  <=  aaveBufferValue + recoverableLP_USDC + juniorReserveValue
```

i.e. the design *targets* keeping the community's par USDC claim covered by (idle Aave + the USDC
recoverable from the LP + the team's junior reserve). This is the invariant the vault is built to hold —
not an unconditional guarantee: redemption is **solvency-aware** — par while that coverage holds, and a
transparent **pro-rata haircut** if a tail event ever exhausts it (H1). The 80/20 default keeps the
LP-exposed slice small enough the junior comfortably covers worst-case IL. Supporting invariants:

| Invariant | Statement |
|---|---|
| `invariant_senior_par` | senior claim <= total recoverable backing (above) — **the headline** |
| `invariant_senior_price_free` | `previewWithdraw`/senior NAV never read the pool price (MTM does not touch senior) |
| `invariant_junior_first_loss` | any drawdown hits `juniorValue` to zero before `seniorClaim` moves |
| `invariant_lock_enforced` | junior cannot withdraw reserve before `lockExpiry` (hard cliff) |
| `invariant_fees_to_senior_during_lock` | while `teamFeesRedirected`, 100% of credited fees raise senior NAV, 0 to junior |
| `invariant_rounding_favors_vault` | `burnForPayment` frees >= requested USDC; deposit mints <= fair (v1 property, lifted) |
| `invariant_no_unauthorized_settlement` | only `gateway` burns senior for payment; only team (post-lock) redeems junior |

The handler drives: senior deposit/withdraw, `burnForPayment` (as gateway), team commit + post-lock
redeem, LP fee accrual, simulated price moves (to stress IL -> junior), Aave interest accrual,
governance `setIdleBufferTarget`.

---

## 6. Contract shape (new: `MintwareTreasuryVault`)

New contract — it fuses three things we own, but the tranche accounting is genuinely new, so a
clean vault is safer than bolting onto either base. It **lifts** proven code rather than reinventing:

- Senior share math + `IYieldVault` surface -> lifted from `MintwareYieldVault` (v1).
- `commitTeam`/`activate`/`lockExpiry`/`teamFeesRedirected`/90d cliff -> mirrored from
  `MintwareMatchedLiquidityVault`.
- Idle-in-Aave -> the deployed `AaveV3YieldAdapter` behind `IYieldAdapter`.
- LP deploy/recover -> internal seam for the JIT engine to compose later.

```
MintwareTreasuryVault is IYieldVault, ReentrancyGuard, Pausable
  -- senior (community) --------------------------------------
  seniorShares, seniorClaim, accruedSeniorYield
  depositUSDC(assets, minShares) -> mints senior (80% Aave / 20% LP-earmark)
  previewWithdraw / burnForPayment / idleBuffer            (IYieldVault, onlyGateway on burn)
  -- junior (team) -------------------------------------------
  commitTeam(teamTokens, targetQuote, fundingWindow, lockDur>=90d)
  activate() -> deploys the matched LP, sets lockExpiry, teamFeesRedirected=true
  redeemJunior() -> post-lock only, residual equity
  -- engine --------------------------------------------------
  adapter (AaveV3YieldAdapter), idleBufferTargetBps (gov, [5000,9500])
  _deployToLP / _recoverFromLP        <- JIT hook composes here in the follow-up
  accrueFees(feesUSDC) -> 100% senior while locked, else 60/30/10
  -- admin ---------------------------------------------------
  setGateway (set-once), setIdleBufferTarget (gov), pause
```

## 7. Sequencing / gate

1. Spec (this doc). 2. Contract in the worktree. 3. Full invariant suite (§5) at 256x128k, 0 reverts.
4. Unit tests: inflation attack (lifted), senior-price-free under a 50% price crash, junior wiped
   before senior moves, lock cliff, fees-to-senior-during-lock, `burnForPayment` waterfall through LP.
5. `forge --sizes` under EIP-170 (extract libs if needed — the JIT-later scope helps here).
6. My line-by-line review of the money path. 7. PR. Deploy + JIT-compose are separate follow-ups.
