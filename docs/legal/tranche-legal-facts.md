# Tranche legal facts — the code-citation companion

**What this is.** The three strongest legal facts about Mintware's tranche vaults, each stated
precisely and backed by the exact `file:line` in the contract source that *proves* it, plus the
guard-tests that lock it down. This is the **code-citation** companion; the case-law rationale
(BarnBridge / *Reves* / the Howey analysis of a first-loss priority buffer) lives in its own doc,
[`priority-buffer-redesign.md`](./priority-buffer-redesign.md) — reference that for the legal
theory, this for the on-chain proof.

> **Caveat — testnet + unaudited.** The contracts below are deployed only on testnet (Base Sepolia
> / Circle Arc testnet), on empty vaults with valueless test USDC, and have **not** had an external
> audit. These facts describe the **code as written and tested**; an independent audit is the gate
> before any real value. Nothing here is legal advice or an offer.

The two vaults in scope:

| Contract | Role |
|---|---|
| `contracts-v4/src/payments/MintwareTreasuryVault.sol` | YPN treasury vault — community USDC **senior** (par, spendable), team reserve **junior** (first-loss). |
| `contracts-v4/src/vaults/MintwareMatchedLiquidityVault.sol` | Matched-liquidity launch vault — community-matched (free) side, team-locked side. |

Guard-tests (all passing): `contracts-v4/test/legal/{JuniorBinding,WaterfallImmutable,CommunityFeesUnrestricted}.t.sol`.

---

## FACT 1 — the junior is the operator's own capital: permanently team-bound, zero outside investment

**Claim.** The junior / first-loss tranche is the operator (team)'s **own** capital. It is internal
vault accounting — never a transferable ERC-20 "junior share" — redeemable **only** by the `team`
address fixed at construction, and it can never be reassigned to, or withdrawn by, any non-team
account. No outside party ever invests in, holds, or can extract the junior.

**Why it matters (legal).** There is no junior *security* sold to the public and no outside
first-loss investor: the party bearing first loss is the operator itself, with its own money, under
an on-chain restriction it cannot lift. See [`priority-buffer-redesign.md`](./priority-buffer-redesign.md).

**Proof — `MintwareTreasuryVault.sol`:**

- Junior is internal accounting, not a share token: `juniorTokens`
  (`MintwareTreasuryVault.sol:162`) + `juniorUsdcBuffer` (`:164`) are plain `uint256` counters; the
  only per-holder share ledger is `seniorShares` (`:142`) — there is **no** junior balance mapping,
  transfer, or mint anywhere.
- `team` is bound once at construction (`constructor` assigns `team = team_`, `:287` region) and has
  **no setter** — grep the file: there is no `setTeam`. It is `address public team;`
  (`MintwareTreasuryVault.sol:161`).
- The junior's only exit is `redeemJunior()` (`MintwareTreasuryVault.sol:491`), gated
  `if (msg.sender != team) revert OnlyTeam();` (`:492`) — every non-team caller reverts, including
  the owner.

**Proof — `MintwareMatchedLiquidityVault.sol`:**

- `address public immutable team;` (`MintwareMatchedLiquidityVault.sol:101`) — truly immutable, no
  setter.
- The team side is `uint128 public teamLiquidity;` (`:129`) — a count of V4 liquidity units, not a
  minted token — and its only exit is `teamWithdraw()` (`:556`), `onlyTeam` (modifier at `:257`) and
  hard-cliff-gated `if (block.timestamp < lockExpiry) revert StillLocked();` (`:558`).

**Locked down by:** `test/legal/JuniorBinding.t.sol` — `testFuzz_redeemJunior_reverts_for_any_non_team`,
`test_owner_cannot_redeem_junior`, `test_team_binding_is_immutable_no_setter_reassigns_it`,
`test_junior_first_loss_released_only_to_team`, `test_junior_is_internal_accounting_not_a_transferable_share`;
and for the matched vault `testFuzz_teamWithdraw_reverts_for_any_non_team`,
`test_team_is_immutable_across_owner_setters`, `test_team_liquidity_released_only_to_team_after_cliff`.

---

## FACT 2 — the waterfall is immutable: senior-first, par, no admin override

**Claim.** Community (senior) is paid **first**, at par, automatically, by code. The seniority of
the payout and the fee-split proportions are hard-coded; there is **no owner-settable payout /
waterfall / par ratio** anywhere. Every `set*` is either a bounded, 48h-timelocked *risk* parameter
or a plumbing *address* — none can change who is paid first or how the pot is split.

**Why it matters (legal).** The priority of the community claim is a property of the code, not a
discretionary promise by an operator — nobody can reorder the waterfall or dilute the senior claim
after the fact. See [`priority-buffer-redesign.md`](./priority-buffer-redesign.md).

**Proof — `MintwareTreasuryVault.sol`:**

- Senior-before-junior is code-enforced. First-loss is releasable only once the senior is no longer
  LP-exposed: `_seniorFullyCovered()` (`MintwareTreasuryVault.sol:530`) returns
  `deployedFromSenior == 0` (`:532`) with no JIT loan in flight, and `redeemJunior` gates the
  first-loss release on it (`:505` region). On a redemption, the junior is drawn **last**: the
  `_pullUSDC` waterfall (`:1040`) goes free senior buffer → Aave → LP unwind → junior USDC buffer
  (`:1054`), reverting rather than underpaying the senior.
- The seniority swap itself sells the recovered **team** leg to make senior USDC whole first:
  `MWTreasuryPositionLib.recover` (`contracts-v4/src/payments/lib/MWTreasuryPositionLib.sol:106`,
  "Seniority: sell ONLY the recovered team leg" at `:129`).
- The fee split is `constant`, not a setting: `FEE_COMMUNITY_BPS = 6_000` (`:105`),
  `FEE_TEAM_BPS = 3_000` (`:106`), `FEE_PROTOCOL_BPS = 1_000` (`:107`) — 60/30/10, summing to 100%.
- No owner-settable payout ratio: every setter is a risk param (`setIdleBufferTarget`, `setJitCap`,
  `setMinCoverage`, `setMaxBurnPerBlock`, `setJitMaxCumulativeLoss` — all routed through the bounded
  48h-timelock `MWTimelockedRiskParams`) or a plumbing address (`setGateway`, `setProtocolTreasury`,
  `setJitHook`, `setRentFunder`). None touches the fee split or the seniority ordering. (See the
  `// AUDIT (legal) — FACT 2` block above the setters, `MintwareTreasuryVault.sol` `setGateway` region.)

**Proof — `MintwareMatchedLiquidityVault.sol`:**

- `MINTWARE_FEE_BPS = 2_500` is `constant` (`MintwareMatchedLiquidityVault.sol:80`); the 50/50
  team/community split is hard-coded at activation (`teamLiquidity = liquidity / 2`, `:403`). No
  owner setter changes either.

**Locked down by:** `test/legal/WaterfallImmutable.t.sol` — `test_fee_split_is_a_hard_constant`,
`test_no_owner_setter_changes_the_payout`, `test_first_loss_release_gated_on_senior_covered`,
`test_community_paid_first_at_par_junior_absorbs_loss`, and `test_mintware_fee_is_a_hard_constant`.

---

## FACT 3 — the community keeps full, unrestricted MEV / pool-fee yield

**Claim.** While the team is locked, swap-fee and am-AMM MEV-rent yield accrues to the **community**
units only. The team's units are **excluded from the fee denominator** — the team earns **0%**, the
community earns **100%** of the LP remainder (net of the fixed protocol cut). The community's upside
is unrestricted: no cap, no team skim, no admin throttle.

**Why it matters (legal).** The community's economic return is its own, undiluted by the operator
during the lock — the first-loss provider forgoes yield, it does not harvest it. See
[`priority-buffer-redesign.md`](./priority-buffer-redesign.md).

**Proof — `MintwareMatchedLiquidityVault.sol`:**

- The fee denominator excludes the team while locked:
  `uint256 denom = teamFeesRedirected ? totalCommunityShares : (totalCommunityShares + teamLiquidity);`
  (`MintwareMatchedLiquidityVault.sol:653`) — during the lock the team's `teamLiquidity` is **not**
  in the denominator, so its per-share accrual is zero.
- The team cannot claim during the lock: `_claimTeamFees()` returns early
  `if (teamFeesRedirected || teamLiquidity == 0) return; // still locked → team earns 0`
  (`:585`–`:586`).
- am-AMM MEV rent routes through the identical split (same `denom`), so the "MEV" leg is treated the
  same as pool fees.

**Locked down by:** `test/legal/CommunityFeesUnrestricted.t.sol` —
`test_fee_denominator_excludes_team_while_locked` (asserts `denom == totalCommunityShares`, strictly
below `totalCommunityShares + teamLiquidity`), `test_team_earns_zero_community_earns_during_lock`,
`test_community_receives_full_lp_remainder_while_locked` (community's claimable ≈ 100% of the LP
remainder).

---

## The legal argument, in one line

The operator puts up its **own** first-loss capital under an **immutable, on-chain** restriction it
cannot lift (FACT 1); the community's senior claim is paid **first and at par by code**, with no
operator discretion over the waterfall (FACT 2); and the community keeps the **full, undiluted**
protocol-native yield while the operator's stake earns nothing during the lock (FACT 3). Together
these are structural properties of the deployed bytecode, verifiable on-chain and pinned by the
guard-tests above — **subject to the testnet + unaudited caveat at the top of this file.**
