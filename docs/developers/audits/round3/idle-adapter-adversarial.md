# `MintwareIdleYieldAdapter` — adversarial review (round-3 pass)

**Scope:** `contracts-v4/src/vaults/MintwareIdleYieldAdapter.sol` + the idle-mode branches of
`scripts/preflight-lp-gateway-mainnet.mjs` and `scripts/deploy-lp-gateway-mainnet.mjs`, as they exist on
`feat/lp-gateway-idle-yield-adapter` (commit `4b87248e`, PR #483).
**Why:** the contract is <1 day old, was written by the same author as its own 18 unit tests, and had no
independent adversarial pass. Every other money-path piece in this repo went through three rounds of
exploit-replay first. This is that pass, done as if the existing tests prove nothing.
**Posture:** no `contracts-v4/src/` file was modified. Findings are reported with a runnable PoC and a
recommended fix; the lead applies fixes centrally.

**Bottom line:** no fund-loss bug, no access-control hole, no arithmetic hole. The contract is
sound *in isolation* — the 18 existing tests are correct as far as they go. What the isolated tests could not
see is **composition**: two of the three real findings are things the contract does *correctly* that the
surrounding system, its docs, and the operator's mental model assume it does differently.

---

## Findings

| # | Sev | Title | Status |
|---|---|---|---|
| **IA-10** | **MEDIUM** | `withdraw` has no try/catch — a frozen adapter **bricks the whole exit**, taking the LP leg down with it. Regresses the `IYieldAdapter` "never reverts" contract and the PM's M-01 / A-1 / F-02 design. | **FIXED** — raw low-level call, serves 0 on any failure instead of reverting (`MintwareIdleYieldAdapter.sol` `withdraw`) |
| **IA-11** | **MEDIUM** | `depositCap` bounds the **idle leg only**, not total value at risk. `deploy()` reopens headroom, so the real ceiling is **2 × cap**. Directly contradicts the deployment record + the preflight row text. | **FIXED (stronger than recommended)** — new on-chain `MintwareLpGatewayPositionManager.principalCap` bounds `idle + deployedPrincipal + deployedPairedValue` directly (not just the doc/halved-cap workaround); `deposit`/`deploy` revert `PrincipalCapExceeded` above it |
| **IA-4** | **MEDIUM** | `compoundQuote` (the runbook's **mandatory** `restake` destination) has no try/catch and **reverts whenever the adapter is at cap** — the normal steady state for a deliberately small cap. Stuck harvest loop + repeated wasted gas. | **FIXED** — `try staging.stage(amount) {} catch { emit CompoundDeferred(amount); }`, mirroring `deploy()`'s R3-2 re-stage; deferred quote stays parked in the PM, already counted by `_idle()` |
| **IA-3** | **LOW** | Donation griefing: anyone can shut the deposit door for everyone by donating the remaining headroom. Cost = the headroom; recovery = owner-only cap raise. | **FIXED** — cap is checked against tracked `suppliedPrincipal` (cumulative vault-initiated deposits minus withdrawals), not live `balanceOf`; a donation no longer moves the cap gate in either direction |
| **IA-12** | **LOW** | Preflight has **no upper bound** on `LP_GATEWAY_DEPOSIT_CAP` — a fat-fingered `2^256-1` reads `PASS` under a row that claims to "bound total value at risk". | **FIXED** — both `LP_GATEWAY_DEPOSIT_CAP` and `LP_GATEWAY_PRINCIPAL_CAP` are asserted ≤ 100,000 USDG unless `LP_GATEWAY_ALLOW_LARGE_CAP=true` |
| **IA-13** | **LOW** | Idle mode + a configured real `LP_GATEWAY_YIELD_SOURCE` is an **INFO row only** — it cannot fail the preflight, so the real source is silently ignored and a zero-yield adapter ships. | **FIXED** — now a `FAIL` unless acknowledged via `LP_GATEWAY_IDLE_MODE_IGNORES_SOURCE=true` |
| **IA-14** | **INFO** | Two independent, differently-behaved readers of `LP_GATEWAY_DEPOSIT_CAP`. `''` → preflight `FAIL`, deploy `0n`. Direction is fail-closed. | Informational |
| **IA-15** | **INFO** | `setDepositCap` is instant with no timelock and no on-chain ceiling — the *only* exposure bound, while the strictly less consequential harvest-recipient lever got a 48 h timelock. | Informational |
| IA-1, IA-2, IA-5, IA-6, IA-7, IA-8, IA-9, IA-F1, IA-F2 | — | **Confirmed safe** with tests (see below). | No action |

---

## Target 1 — integration, not isolation

New test files (both new, both run below):

* `contracts-v4/test/gateway/MintwareLpGatewayIdleAdapter.t.sol` — the idle adapter wired into the **real**
  `MintwareLpGatewayStaging` + `MintwareLpGatewayPositionManager`, built in exactly the transaction order
  `scripts/deploy-lp-gateway-mainnet.mjs` uses (`adapter(asset, vault=ZERO, owner, cap)` → `staging` → `pm` →
  `setController` → `setVault`). Template: `test/gateway/MintwareLpGatewayRealAdapter.t.sol`.
* `contracts-v4/test/fork/MintwareLpGatewayIdleAdapterFork.t.sol` — the same rig against the **real Uniswap V4
  periphery** on Robinhood Chain testnet, so `deploy` / `harvest` / `compoundQuote` / the deferred re-stage are
  genuinely exercised. Self-skips without `LP_FORK_RPC_URL`, matching the existing fork harnesses.

### 1a. Does hitting `depositCap` mid-`_deposit()` produce a failure mode the stack was designed around?

**Yes — it is byte-identically handled, and it is a clean atomic revert.** `MintwareLpGatewayStaging.stage()`
calls `adapter.deposit` with no try/catch, so `DepositCapExceeded` propagates to `PM._deposit` and reverts the
whole transaction. That is *exactly* what the sibling `MintwareERC4626YieldAdapter` does when the 4626 source
is at its supply cap (`ERC4626ExceededMaxDeposit`, the live Morpho mainnet state), so nothing up the stack needs
new handling on the deposit path. Proven atomic (no shares minted, no tokens moved, boundary exact to 1 wei) by
`test_IA1_capHitMidDeposit_revertsAtomically_sameShapeAsRealAdapter`.

The `StageShortfall` guard (XR-3) is *not* implicated: the idle adapter credits 1:1 with zero rounding, so the
50 bps tolerance is never consumed — proven at a 1-wei deposit, where the tolerance rounds to 0
(`test_IA_integration_stageShortfallGuard_isExactlyMet`).

### 1b. Does `deploy()`'s `RestageDeferred` try/catch catch `DepositCapExceeded` the way it catches Morpho's?

**Yes.** `deploy()` uses a **bare** `catch { … }` (`MintwareLpGatewayPositionManager.sol:732-736`), which
swallows every revert shape — custom errors, `Error(string)`, and `Panic` alike. Proven two ways:

* `test_IA5b_bareCatchSwallowsBothRevertShapes` — a probe contract with the identical `try/catch` shape
  swallows both `DepositCapExceeded` and the arithmetic panic from IA-5.
* `test_forkIA_F2_deployRestage_catchesDepositCapExceeded` (fork) — with the cap shut to 0 mid-flight, a real
  `deploy()` against real V4 still **succeeds**, emits `RestageDeferred`, parks the leftover quote in the PM
  where `_idle()` still prices it as depositor principal (R3-INV-2 holds), and the next `deploy()` draws that
  parked quote down first.

### 1c. Does `_syncIdle()` / `totalNav()` handle balance-based accounting with no share-price concept?

**Yes.** The VIRTUAL=1e6 offset math in `SeniorSharesMath` is indifferent to how the idle leg is measured — it
only ever sees a `uint256` NAV. Proven end to end on the fork
(`test_forkIA_F1_fullCycle_depositDeployHarvestWithdraw`: deposit → deploy → real swaps → harvest → withdraw,
both legs delivered, NAV intact within LP rounding) and on the unit rig
(`test_IA_integration_depositRoutesIntoIdleAdapter`, `test_IA_integration_multiHolderRoundTrip_exact`).

One thing the balance-based read *does* change vs. the 4626 adapter is **donation sensitivity**: the 4626
adapter's `totalAssets()` is `previewRedeem(sharesHeld)`, so a raw-asset donation to the adapter is invisible;
the idle adapter's is `balanceOf(this)`, so a donation lands straight in NAV. That is deliberate and safe for
share math — `test_IA2_donationInflation_isNeutralisedByVirtualOffset` proves a 1-wei-seed + full-cap donation
does **not** round a subsequent depositor to zero shares and does not steal from them. But it is the mechanism
behind IA-3 below, and it is worth stating explicitly since the NatSpec claims parity with the sibling adapter.

---

## IA-10 (MEDIUM, REAL) — `withdraw` can revert, and that breaks "withdrawals never brick"

### What

```solidity
function withdraw(uint256 amount) external override onlyVault nonReentrant returns (uint256 withdrawn) {
    uint256 bal = asset.balanceOf(address(this));
    withdrawn = amount < bal ? amount : bal;
    if (withdrawn == 0) return 0;
    asset.safeTransfer(vault, withdrawn);   // <-- bare, no try/catch
    emit Withdrawn(amount, withdrawn);
}
```

`IYieldAdapter.withdraw` is specified as *"NEVER reverts for a liquidity/availability reason — returns 0 or a
partial amount so the caller can fall back."* The production `MintwareERC4626YieldAdapter` honours this with an
explicit `try yieldSource.redeem(...) { } catch { return 0; }`. The idle adapter has no such guard. The
contract's own NatSpec argues it doesn't need one — *"since funds are NEVER deployed anywhere else,
'best-effort' always equals 'full' here — the only clamp is our own balance."* That reasoning covers **source
liquidity** but not **token-level availability**, and the quote asset here is **USDG, whose issuer can freeze an
address** (M-07; the preflight already calls `isFrozen()` on the signer and the harvest recipient, so this
threat is explicitly in scope for this deployment).

### Why it matters more than "the frozen funds are stuck anyway"

If the issuer freezes the adapter, the frozen USDG is unrecoverable either way — that part is not the finding.
The finding is the **collateral damage**: `PM._withdraw` calls `staging.unstage(...)` **outside** any try/catch
(line 557), gated only on `idleOk`, and `idleOk` is computed from `staging.stagedAssets()` → `balanceOf`, which a
freeze does **not** make revert. So the PM believes the source is healthy, calls straight through, and the
adapter's `safeTransfer` reverts the entire exit — including the **LP leg**, which is a *different, unfrozen*
token and up to 50% of principal (`MAX_DEPLOY_BPS = 5000`). The A-1 / F-02 / RT-6 design ("each leg is
best-effort and independently re-credited; withdrawals never brick") is defeated for the quote leg's failure
mode, and the paired leg becomes unwithdrawable as a side effect.

### PoC

`test_IA10_FINDING_frozenAdapter_bricksWithdraw_violatingNeverBricks` — a `RTBlacklistERC20` (the repo's own
Paxos-USDG-shaped red-team token, `test/audit/RedTeamOnchainTokens.sol`) stands in for USDG. Alice deposits, the
issuer freezes the adapter, `pm.withdraw()` reverts `BLACKLISTED` outright. `sourceReadable()` still returns
`true`, proving the PM never gets a chance to degrade gracefully.

`test_IA10b_realAdapter_sameFreeze_degradesGracefully` — the identical availability failure against the
**production** 4626 adapter: `withdraw` returns 0, the PM re-credits every share, the call does **not** revert.
This is the behaviour the idle adapter regresses.

### Recommended fix

Wrap the transfer, mirroring the sibling:

`SafeERC20.safeTransfer` **cannot** be wrapped in `try/catch` — it is an internal library call, inlined into
this contract, so there is no external-call boundary for `try` to bind to. Use a low-level call that tolerates
both bool-returning and void-returning ERC-20s and never reverts:

```solidity
if (withdrawn == 0) return 0;
(bool success, bytes memory ret) =
    address(asset).call(abi.encodeCall(IERC20.transfer, (vault, withdrawn)));
if (!success || (ret.length != 0 && !abi.decode(ret, (bool)))) {
    return 0; // frozen / paused / non-compliant token -> serve 0, let the PM re-credit (A-1)
}
emit Withdrawn(amount, withdrawn);
```

With that, the frozen-quote scenario degrades to "idle leg served 0, shares re-credited, LP leg still paid" —
exactly the A-1 contract the rest of the stack was designed around. (`test_IA10b_…` shows that is precisely how
the 4626 adapter already behaves; `test_IA10_…` becomes the regression test for the fix.)

---

## IA-11 (MEDIUM, REAL) — `depositCap` bounds the idle leg, not total value at risk

### What

`deposit()` checks `asset.balanceOf(address(this)) + amount > depositCap`. That balance falls every time
`deploy()` moves capital into the LP — which **reopens the cap headroom**, letting fresh deposits refill the
idle leg while the deployed principal is still depositor money at risk. The cap therefore bounds
`idle`, not `idle + deployedPrincipal`.

The system's other bound keeps this finite: `MAX_DEPLOY_BPS = 5000` enforces
`deployedPrincipal + toDeploy ≤ (idle + deployedPrincipal) / 2`, i.e. `deployedPrincipal ≤ idle ≤ cap`. So the
series converges to **2 × cap**, not ∞ — but also not 1 ×.

### Why it matters

Three operator-facing artefacts assert the wrong number:

* `scripts/deploy-lp-gateway-mainnet.mjs:312` writes into the deployment record:
  *"depositCap {…} atomic (owner-adjustable, **this IS the bound on total value at risk** while unaudited)"*
* `scripts/preflight-lp-gateway-mainnet.mjs:235` prints the row
  *"LP_GATEWAY_DEPOSIT_CAP set (**bounds total value at risk** while unaudited)"*
* `docs/developers/lp-gateway-mainnet-runbook.md` §8 ties the recorded **own-funds cap** decision to
  `adapter.setDepositCap(newCapAtomic)` one-for-one.

An operator following §8 who records "step 1: ≤ 1 000 USDG" and sets `depositCap = 1000e6` can end up with
~2 000 USDG of their own money exposed. On a pre-audit mainnet instance that is exactly the number that must not
be wrong. (`docs/developers/audits/closeout/mainnet-yield-sources.md` is the one place that says it correctly —
"separate from and **in addition to** the position manager's own `MAX_DEPLOY_BPS` cap".)

### PoC

* `test_forkIA_11_FINDING_capBoundsIdleOnly_totalValueExceedsIt` — deposit exactly `cap`, `maxSuppliable() == 0`;
  one `deploy()` reopens headroom; a second depositor refills the idle leg; `totalNav()` is now **~1.5 × cap**
  and rising.
* `test_forkIA_11b_ceilingIsTwiceTheCap_notUnbounded` — iterates the deploy/refill loop and asserts the invariant
  `deployedPrincipal ≤ cap ∧ idle ≤ cap`, so `totalNav ≤ ~2 × cap`. Bounded, but 2 ×.

### Recommended fix

Cheapest correct fix is documentation + halving the configured cap. The stronger fix, if the cap is meant to be
a real exposure bound, is to check it against total gateway principal rather than adapter balance — e.g. have
the PM expose `deployedPrincipal` and the adapter reject when `bal + deployedPrincipal + amount > depositCap`
(adds a PM dependency to the adapter, which is why it isn't the default recommendation). At minimum:

* change both strings to *"bounds the IDLE leg; with `MAX_DEPLOY_BPS = 5000` total depositor value at risk
  converges to 2 × this"*, and
* add a preflight row printing `2 × cap` as the actual worst case, so §8's recorded decision and the on-chain
  knob can be reconciled honestly.

---

## IA-4 (MEDIUM, REAL) — `compoundQuote` reverts whenever the adapter is at cap

### What

`PM.compoundQuote(amount)` → `staging.stage(amount)` → `adapter.deposit(amount)` — **no try/catch anywhere on
this path** (contrast `deploy()`'s re-stage, which was explicitly given one by R3-2 for exactly this reason).
So restaking harvested fees reverts `DepositCapExceeded` the moment `adapter.balanceOf == depositCap`. For a
deliberately small cap, *at cap* is the intended steady state.

### Why it matters

`docs/developers/lp-gateway-mainnet-runbook.md` marks
**`LP_GATEWAY_HARVEST_DESTINATION=restake` as mandatory** on mainnet (the buffer-credit alternative is the
un-fixed A-4/O-4 ledger and must never be enabled). `lib/gateway/harvest.ts:260` sends `compoundQuote` with a
**hard-coded `gas: 400_000n`**, so the call is not gas-estimated away — it *mines reverted*, `mined === false`,
the ledger claim is released (`releaseRestake`), and the cron returns `compound_reverted`. The next scheduled
run repeats it. Net effect: fees pile up at the harvest recipient, ledger rows churn pending → restaking →
pending, and every run burns gas on a guaranteed-revert transaction, until a human notices and raises the cap.
No fund loss; a real recurring ops failure that only shows up once the gateway is full.

### PoC

`test_IA4_FINDING_compoundQuote_revertsWhenAdapterIsAtCap` — fill to cap, `compoundQuote(100e6)` reverts
`DepositCapExceeded`; raise the cap by exactly 100e6 and the identical call succeeds, isolating the cap as the
sole cause. `test_forkIA_F1b_compoundQuote_liftsNavWithHeadroom` shows the happy path with headroom.

### Recommended fix

Either (a) exclude compounded fees from the cap — the cap is meant to bound *deposited* principal, and
compounding is accretion to existing holders, not new exposure; or (b) give `compoundQuote` the same
best-effort treatment `deploy()`'s re-stage got, leaving un-compoundable fees parked in the PM (where `_idle()`
already prices them) and emitting a `CompoundDeferred` event for the cron to log rather than retry-loop on.
(a) is the semantically right answer.

---

## IA-3 (LOW, REAL) — donation griefing shuts the deposit door

The cap is measured against the live balance and the adapter accepts unsolicited transfers, so anyone can send
`maxSuppliable()` worth of USDG to the adapter and make **every** subsequent `deposit()` revert for **everyone**,
indefinitely, until the owner raises the cap. Withdrawals are unaffected (the adapter never reverts on the way
out, freeze aside — see IA-10), and the griefer's donation accrues pro-rata to existing holders, so the attack
is *expensive* — cost = the headroom, benefit = zero. But at the small caps idle mode exists for (the runbook's
step 1 is ≤ 1 000 USDG) it is cheap enough to be a plausible nuisance, and it is a live incident requiring an
owner transaction.

PoC: `test_IA3_FINDING_donationDoS_closesDepositsForEveryone`.

Not obviously worth fixing (tracking a separate `_totalSupplied` instead of reading the balance would make the
cap donation-proof, but would then let a donation push actual holdings above the cap — trading one honesty
problem for another). Recommendation: **accept and document**, and add `adapter.maxSuppliable()` to the
gateway's monitoring so a headroom collapse pages the operator instead of surfacing as user-facing deposit
failures.

---

## Target 2 — the deposit-cap check itself

### Overflow class

`bal + amount > depositCap` is Solidity 0.8 checked arithmetic. At extreme values it reverts with
**`Panic(0x11)`**, not `DepositCapExceeded` — a different revert shape than the one the NatSpec documents.
Proven at `bal = 2^255 + 2`, `amount = 2^255 - 1` by `test_IA5_capCheckOverflow_panicsNotCustomError_atExtremes`.

**Not a bug.** It is unreachable with any real token (it needs an adapter balance and a single deposit amount
summing past `2^256`; USDG's total supply is ~10 orders of magnitude short), and the only caller that catches at
all uses a bare `catch`, which swallows panics too — proven by
`test_IA5b_bareCatchSwallowsBothRevertShapes`. Recorded because the question was asked and the answer should be
"proven", not "assumed".

### Can a donation-then-deposit sequence slip a real deposit over the cap by 1 wei?

**No.** The cap is read against the **live** balance inside `deposit()`, after any donation is already counted.
Two fuzz tests hold it:

* `testFuzz_IA6_depositNeverExceedsCap(cap, donation, amount)` — over arbitrary caps, arbitrary prior donations
  and arbitrary amounts, a successful deposit always leaves `totalAssets() ≤ cap`, and a refused one moves
  nothing.
* `testFuzz_IA6b_donationThenDepositCannotSlipOverCap(donation, amount)` — a deposit is refused **only** when
  `donation + amount` genuinely exceeds the cap; never a false accept.

---

## Target 3 — preflight / deploy scripts, as an operator-error class

PoC script: `scripts/__audit__/idle-mode-env-poc.mjs` (`node scripts/__audit__/idle-mode-env-poc.mjs`). It
imports the real `resolveConfig` and replicates the deploy script's own parsing lines verbatim.

### (a) `LP_GATEWAY_IDLE_MODE=true` **and** a real `LP_GATEWAY_YIELD_SOURCE` — warn or block?

**Warn only, and it should block.** `scripts/preflight-lp-gateway-mainnet.mjs:231` emits the row with
`info(...)`, and `finish()` computes `ok = rows.every(r => r.status !== 'FAIL')` — an `INFO` row can never fail
the preflight, and the deploy script proceeds (`SOURCE = null`, line 141). The operator's configured Morpho
vault is silently discarded, a zero-yield adapter ships in its place, and the deployment record the script
prints then *asserts* "no external yield source (none exists for USDG on this chain yet)". The row is one
`· info` line among ~40, printed at 2am, in the exact scenario the row is meant to catch.

This is a genuinely contradictory configuration — the two variables express opposite intents — and it is
distinguishable from every legitimate case (idle mode with the variable unset). It should be a `FAIL` with an
explicit acknowledgement override:

```js
const ackIgnoreSource = (env.LP_GATEWAY_IDLE_MODE_IGNORES_SOURCE ?? '').toLowerCase() === 'true'
if (isAddress(cfg.yieldSource) && !ackIgnoreSource) {
  fail('source', 'LP_GATEWAY_IDLE_MODE=true AND LP_GATEWAY_YIELD_SOURCE set',
       `contradictory: ${cfg.yieldSource} would be IGNORED and a zero-yield adapter deployed. ` +
       'Unset LP_GATEWAY_YIELD_SOURCE, or set LP_GATEWAY_IDLE_MODE_IGNORES_SOURCE=true to acknowledge.')
}
```

The whole design of this preflight is "fail closed on ambiguity" (`LP_GATEWAY_USDG` mismatch fails,
`maxDeposit == 0` fails, an unset cap fails). Silently ignoring a configured yield source is the one place it
doesn't, and it is the highest-consequence ambiguity in idle mode.

### (b) Is `LP_GATEWAY_DEPOSIT_CAP=0` handled identically everywhere — any `?? 0` / falsy bug?

**The hypothesised falsy bug does not exist for `'0'`, but a related one exists for `''`.** `resolveConfig`
uses `env.LP_GATEWAY_DEPOSIT_CAP ? BigInt(...) : null` — and `'0'` is a **non-empty string**, hence truthy in
JS, so it correctly becomes `0n` and passes the `!= null && >= 0n` gate. The direction is safe throughout: 0 is
"closed" on-chain, so no path opens anything wider than intended.

What the PoC does surface (full table pasted below):

* **IA-14 (INFO).** Two independent readers with different rules. `LP_GATEWAY_DEPOSIT_CAP=` (set but empty — an
  unresolved `$VAR`, or a bare `KEY=` line in a `.env`) is `FAIL` in the preflight but `BigInt('') === 0n` in the
  deploy script. The real run dies on the preflight `FAIL` before that matters, so it is contained; the
  `--dry-run` path (which downgrades a preflight failure to a warning and continues) prints a plan with
  `deposit cap 0`. Direction fail-closed. Fix: make the deploy script import `resolveConfig` rather than
  re-parse, or reject `''` explicitly.
* `'  '` (whitespace only) reads as `0n` in **both** — `PASS`, cap 0, silently closed. Fail-closed but
  surprising; worth a "not a decimal integer" shape check.
* `'10000e6'` / `'10_000'` (human shorthand an operator will absolutely try) throws an uncaught `SyntaxError`
  out of `resolveConfig`, crashing the preflight rather than printing a `FAIL` row. Fail-closed but a bad
  message.
* **IA-12 (LOW).** There is **no upper bound**. `LP_GATEWAY_DEPOSIT_CAP=115792089237316195423570985008687907853269984665640564039457584007913129639935`
  reads `PASS`, under a row whose own text is *"bounds total value at risk while unaudited"*. Three extra zeros
  on a real value does the same. For a pre-audit mainnet deploy whose entire safety story is "a small bounded
  cap", the preflight should assert a ceiling — e.g. `cfg.depositCap <= 100_000e6` unless
  `LP_GATEWAY_ALLOW_LARGE_CAP=true` — and print the human-unit value **and** `2 × cap` (per IA-11) so the
  operator sees the number they are actually authorising.

### (c) Does the post-wire assertion verify `adapter.depositCap()` exactly, with no bigint/number mismatch?

**Yes — this one is clean.** `assertEq` (deploy script lines 253-258) stringifies both sides; viem returns a
`uint256` as a `bigint` and `DEPOSIT_CAP` is a `bigint`, so the comparison is exact. Proven in the PoC:
identical bigints pass, a **1-wei** on-chain difference dies, and a `bigint`/`Number` mix is caught above `2^53`
(where `String(1e21) === '1e+21'`) and is losslessly identical below it. No silent truncation path exists.

---

## Target 4 — ownership / access-control sequencing

### Is there a window where `deposit`/`withdraw` are callable by an unintended `vault`?

**No.** The mainnet script constructs the adapter with `vault_ = ZERO` (line 180: `[USDG, ZERO, signer,
DEPOSIT_CAP]`) and wires `setVault(staging)` in a **separate, later transaction** (line 267). Between the two,
`onlyVault` requires `msg.sender == address(0)`, which no EVM call frame can produce — `address(0)` has no code
and cannot originate a transaction, and no `CALL` can spoof its caller.

Proven belt-and-braces by `test_IA7_zeroVaultWindow_isUnreachable_andFailsClosedAnyway`: nobody real can call
in (`OnlyVault`, including the owner), and when Foundry's `vm.prank(address(0))` **forces** the impossible case,
the ERC-20 legs still fail closed — OZ's `_transfer` reverts `ERC20InvalidReceiver(address(0))` on the way out
and `transferFrom(address(0), …)` has no allowance on the way in. Nothing leaves the adapter.

`test_IA8_gatewayFailsClosedUntilVaultWired` proves the same at the system level: until `setVault(staging)` runs,
every `pm.deposit()` reverts `OnlyVault` — the gateway fails closed rather than mis-routing, mirroring the
existing `test_A5_factoryPath_depositsFailClosedUntilVaultWired` proof for the production adapter.

### Is `onlyOwner` (vs the sibling's deployer-gated pattern) a sequencing risk?

**No, and the difference is not what it looks like.** `MintwareERC4626YieldAdapter.setVault` is *also* plain
`onlyOwner` — the `deployer`-gated pattern is on `MintwareLpGatewayStaging.setController` (finding M1), a
different contract solving a different problem (the staging's controller seat is claimable by a front-runner
because the staging has no owner). The adapter has an owner from construction, so an owner check is the correct
and equivalent guard.

The residual risk is only "the owner sets the wrong vault", and `setVault` being **one-time** means a wrong
value bricks the instance rather than creating a drain — the safe direction, and the deploy script's post-wire
`assertEq('adapter.vault()', …, staging)` catches it immediately.
`test_IA9_compromisedOwner_cannotRedirectTheSink` proves the compromised-key worst case: the sink cannot be
re-pointed, the owner cannot pull funds directly, and the only lever left is `setDepositCap(0)` — which shuts
deposits while withdrawals keep working, so a hostile owner can never trap depositor funds.

### IA-15 (INFO) — the cap lever has no timelock

`setDepositCap` takes effect instantly. It is the **only** on-chain exposure bound on a pre-audit mainnet
instance, yet the strictly less consequential `harvestRecipient` rotation was given a 48 h timelock
(F-02 rec. 3) precisely so a compromised owner key cannot move a money lever instantly. Worth considering a
one-directional guard: instant *lowering* (an incident response must be immediate), timelocked *raising*.

---

## Test runs

### Unit / integration (no network)

```
$ export PATH="$HOME/.foundry/bin:$PATH"
$ forge test --match-contract MintwareLpGatewayIdleAdapterTest -vv
<<UNIT_OUTPUT>>
```

### Existing 18 unit tests (regression — unchanged, still green)

```
$ forge test --match-contract MintwareIdleYieldAdapterTest -vv
<<EXISTING_OUTPUT>>
```

### Fork (real Uniswap V4 on Robinhood Chain testnet)

```
$ LP_FORK_RPC_URL=https://rpc.testnet.chain.robinhood.com \
    forge test --match-contract MintwareLpGatewayIdleAdapterFork -vv
<<FORK_OUTPUT>>
```

### Script PoC

```
$ node scripts/__audit__/idle-mode-env-poc.mjs
<<POC_OUTPUT>>
```

---

## Verdict

**Update (2026-09-08, post-fix pass):** all four recommended pre-deploy actions below have since landed —
**IA-10** (raw-call `withdraw`, already committed with the round-3 tooling-sweep reconciliation), **IA-3**
(donation-proof `suppliedPrincipal` tracking, same commit), **IA-11** (the *stronger* fix, not the documentation
workaround: an on-chain PM-level `principalCap` bounding `idle + deployedPrincipal + deployedPairedValue`
directly, so the operator's configured cap now genuinely IS the total-value-at-risk bound, no halving needed),
**IA-4** (`compoundQuote` now best-effort — `try staging.stage(amount) {} catch { emit CompoundDeferred(amount); }`,
mirroring `deploy()`'s own R3-2 re-stage), and both preflight gaps (**IA-12**'s 100,000 USDG cap ceiling,
waivable via `LP_GATEWAY_ALLOW_LARGE_CAP=true`; **IA-13**'s idle-mode/real-source contradiction now a `FAIL`
unless acknowledged via `LP_GATEWAY_IDLE_MODE_IGNORES_SOURCE=true`). See the Findings table above for exact
locations. The verdict below is the pre-fix analysis, kept for context.

**Safe to deploy at a small bounded cap as written** — no fund-loss, access-control, or arithmetic bug was
found, and the isolation-only test suite's claims all hold up under composition. The three MEDIUMs were
composition and honesty problems rather than exploits: **IA-11** meant the operator had to set `depositCap` to
**half** the exposure they actually intended to authorise (or the strings had to be corrected), **IA-4** meant
the mandatory `restake` harvest destination would start failing on a loop the moment the instance is full, and
**IA-10** meant a USDG issuer freeze cost access to the LP leg as well as the frozen quote.

**Recommended pre-deploy actions, in order — ALL DONE:**

1. ✅ Fix IA-10 (`try`/`catch` around the transfer) — ~6 lines, restores the `IYieldAdapter` contract.
2. ✅ IA-11 — fixed at the root with an on-chain `principalCap` rather than merely correcting the strings /
   halving the configured cap.
3. ✅ Fix IA-4 (best-effort compound, deferred rather than reverted).
4. ✅ Turn IA-13 into a `FAIL` and add IA-12's cap ceiling.
