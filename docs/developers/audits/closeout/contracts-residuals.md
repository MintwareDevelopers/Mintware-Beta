# Audit closeout — contract residuals (2026-09-08)

> Closes the contract-layer items left **⏳ accepted / deferred** in
> [`../2026-09-08-consolidated.md`](../2026-09-08-consolidated.md) §2 (C-9, C-10) and the `harvestRecipient`
> item in §4, i.e. Hacken F-02 rec. 3 / F-06 / F-07 and red-team RT-5f / RT-7d. Branch
> `feat/lp-gateway-audit-closeout`. **Testnet + unaudited** — external audit still gates real value.
>
> **⚠ The live Robinhood-testnet rig (PM `0xd488…b53e`) predates ALL of this. It needs a REDEPLOY**
> (`pnpm deploy:lp-gateway:robinhood`) for the recipient rotation, the C-10 outage tolerance, the two-step adapter
> ownership, and the factory binding check to exist on-chain. Until then the deployed contracts behave as the
> consolidated report describes (immutable recipient; RT-5f total brick; one-step adapter owner).

## Suite counts

| Suite | Before | After |
|---|---|---|
| `contracts-v4/test/gateway/*` | 44 | **61** (+6 factory binding, +6 PM rotation/idle bookkeeping, +5 new `MintwareLpGatewaySourceOutage`) |
| `test/MintwareERC4626YieldAdapter.t.sol` | 14 | **17** (+3 ownership) |
| `test/fork/MintwareLpGatewayHardeningFork` (RPC) | 7 | 7 |
| `test/fork/MintwareLpGatewayAuditRound2Fork` (RPC) | 10 | 10 |
| `test/fork/MintwareLpGatewayCloseoutFork` (RPC, **new**) | — | **5** |
| `test/audit/{HackenContracts,RedTeamOnchainFork,RedTeamOnchainUnit}` (RPC) | 50 | 50 (RT-5f re-shaped to its FIXED form, same count) |
| Full repo `forge test` (no RPC) | 844 pass / 4 skip | **869 pass / 0 fail / 4 skip** (97 suites; +25 = 6 factory + 6 PM + 5 outage + 3 adapter + 5 closeout-fork self-skipping) |
| Fork suites with RPC (`--match-contract 'MintwareLpGateway(Hardening\|AuditRound2\|Closeout)Fork\|RedTeamOnchainFork\|HackenLpGateway'`) | 55 | **60 / 0 fail** |

Run exactly as CI does: `forge test -vv` (no RPC; fork harnesses self-skip) then
`LP_FORK_RPC_URL=https://rpc.testnet.chain.robinhood.com forge test -vv --match-contract 'MintwareLpGateway(Hardening|AuditRound2|Closeout)Fork|RedTeamOnchainFork|HackenLpGateway'`.

## Storage layout (position manager) — the RedTeamOnchainFork slot probe is UNCHANGED

`test/audit/RedTeamOnchainFork.t.sol#_ref()` reads `_refSqrtPrice` via `vm.load(pm, slot 7)`. All new storage was
**appended after `paused`** precisely so nothing above it moves. Verified with
`forge inspect MintwareLpGatewayPositionManager storage-layout`:

| Slot | Var | Note |
|---|---|---|
| 0 / 1 | `_owner` / `_pendingOwner` | Ownable2Step |
| 2–4 | `_poolKey` | |
| 5 | `tokenId` | |
| 6 | `deployedPrincipal` | |
| **7** | `_refSqrtPrice` (uint160, off 0) + `_refBlock` (uint64, off 20) | **probe target — unchanged** |
| 8 / 9 / 10 | `_lastActionBlock` / `sharesOf` / `totalShares` | |
| 11 | `paused` (bool, off 0) + **`harvestRecipient`** (address, off 1) | was `immutable` — now packs here |
| 12 | **`pendingHarvestRecipient`** (off 0) + **`harvestRecipientEta`** (uint64, off 20) | new |
| 13 | **`lastKnownIdle`** | new |

The probe's comment was updated to say so; `_standard()` still asserts the probe against the first anchor on
every fork test, so a future shift is caught immediately.

---

## C-9a — adapter is one-step `Ownable` (Hacken F-06 / RT-7d)

**Files.** `contracts-v4/src/vaults/MintwareERC4626YieldAdapter.sol`.

**Change.** `Ownable` → `Ownable2Step`; `renounceOwnership()` reverts `RenounceDisabled` (as on the PM). `setVault`
stays ONE-TIME; `setPerBlockWithdrawCap` unchanged. Rationale: the adapter owner holds the `perBlockWithdrawCap`
lever, which can throttle every exit of whatever sits on top (RT-7d) — a typo'd one-step transfer would hand that
to a stranger, a renounce would freeze it forever. No test/script in the repo called `transferOwnership` on the
adapter (grep'd `contracts-v4/test`, `contracts-v4/script`, `scripts/deploy-lp-gateway-robinhood.mjs`), so no
call-site fix-ups were needed; the deploy script constructs the adapter with the Privy signer as owner and never
transfers it.

**Tests added** (`test/MintwareERC4626YieldAdapter.t.sol`):
`test_ownership_twoStep_pendingOwnerPowerless_untilAccept` · `test_renounceOwnership_disabled` ·
`test_setVault_stays_one_time_across_owner_handoff`.

**Residual.** The cap lever itself is still instant and unbounded (F-06 also suggested a timelock / floor). Not
done here — it is the operator's own key (same Privy seat as the PM owner) and A-1 re-credits mean delay, not loss.
Track as a follow-up if third-party funds are ever admitted: bound `perBlockWithdrawCap` to ≥ x% of `totalAssets`
or timelock decreases.

## C-9b — factory does not verify the adapter binding (Hacken F-07)

**Files.** `contracts-v4/src/gateway/MintwareLpGatewayFactory.sol` (`_verifyAdapterBinding`, three new errors).

**Change.** `createGateway` now probes the adapter with `staticcall`s before wiring it:
1. `asset()` — if it ANSWERS (production `MintwareERC4626YieldAdapter`), the value MUST equal the pool's
   `quoteAsset` → else `AdapterAssetMismatch`.
2. Else (older/third-party `IYieldAdapter` with no `asset()`, e.g. the Aave adapter's `underlying()`), a sanity
   `totalAssets()` must succeed and return a word — its **value may be zero** (a fresh adapter holds nothing).
   Neither answering → `AdapterUnreadable` (also catches an EOA / codeless address).
3. Best-effort: if `vault()` answers and is already non-zero, the adapter's one-time sink is wired elsewhere and can
   never point at the new staging → `AdapterAlreadyBound`.
It is a **wiring** guard (no more DOA instances), not a trust guard — the curator still vets the adapter; the
factory stays `onlyOwner`. A revert rolls back the `adapterUsed` mark, so a rejected adapter is not burned.

**Tests added** (`test/gateway/MintwareLpGatewayFactory.t.sol`, both branches + guards):
`test_adapterBinding_productionAdapter_matchingAsset_passes` · `test_adapterBinding_productionAdapter_wrongAsset_reverts` ·
`test_adapterBinding_legacyAdapter_noAssetGetter_fallsBackToTotalAssets` · `test_adapterBinding_notAnAdapter_reverts` ·
`test_adapterBinding_eoa_reverts` · `test_adapterBinding_vaultAlreadyWired_reverts`.

**Residual.** The factory cannot call `adapter.setVault(staging)` itself unless it owns the adapter (F-07's other
suggestion) — deploy/ops wires it (the runbook's step 4 + post-wire assertion already does). The live rig was
deployed directly, not through the factory, so this guard protects future curated instances only.

## C-10 — a reverting 4626 `previewRedeem` bricked every NAV read (RT-5f)

**Files.** `contracts-v4/src/gateway/MintwareLpGatewayPositionManager.sol` (`_idle`, `_syncIdle`,
`sourceReadable`, `lastKnownIdle`, `SourceUnavailable`, `IdleLegUnavailable`; `_deposit`, `_withdraw`, `deploy`,
`compoundQuote`, `totalNav`, `_navDepositStrict`).

**Change.** The staged read is tolerant, with the safety split the task specified:
- `_idle()` = `try staging.stagedAssets() … catch (false, 0)`. `lastKnownIdle` is refreshed by **every successful
  state-changing read** (post-stage in deposit, post-unstage in withdraw, post-restage in deploy, compound).
- **Deposit REVERTS** `SourceUnavailable` (via `_syncIdle` inside `_navDepositStrict`) — an entry that can't be
  priced must not mint. `deploy` and `compoundQuote` are strict too (they size off / mutate the reserve; a
  compound whose post-stage refresh fails reverts whole, nothing half-staged).
- **Withdraw proceeds LP-leg-only.** Idle entitlement is sized off `lastKnownIdle`; `unstage` is never called (it
  would revert through the same source); the existing A-1 re-credit machinery then hands back
  `shares × (fromIdle) / (fromIdle + lpEntitled)` — i.e. burns only `shares × lpDelivered / (lpEntitled +
  lastKnownIdle)`, exactly the requested rule. `IdleLegUnavailable` is emitted. If the source is down AND there is
  no LP leg to deliver (`liqToRemove == 0`), the exit **refuses** (`SourceUnavailable`, state untouched) rather than
  burn shares against a zero claim — the zero-claim case was the one place the re-credit could not protect.
- **Views never revert**: `totalNav` falls back to `lastKnownIdle`; `sourceReadable()` tells surfaces to mark it
  STALE. ABI additions: `sourceReadable`, `lastKnownIdle`, `IdleLegUnavailable`.

**Tests added.** Unit (`test/gateway/MintwareLpGatewaySourceOutage.t.sol`, production adapter over the red-team
`RTFlaky4626`): `test_C10_totalNav_fallsBackToLastKnownIdle_neverReverts` · `test_C10_deposit_revertsSourceUnavailable_noMint` ·
`test_C10_withdraw_idleOnly_refusesWithoutBurning_thenRecovers` · `test_C10_deploy_and_compound_failClosed` ·
`test_C10_lastKnownIdle_isLastSuccessfulRead`. Bookkeeping: `test_lastKnownIdle_tracksReserve` (PM suite).
Fork, deployed state (`test/fork/MintwareLpGatewayCloseoutFork.t.sol`):
`test_CF_C10_partialExitDuringOutage_lpPays_idleReCredited_noLoss` (LP slice delivered pro-rata, reserve untouched,
2/3 of requested shares burned = delivered/claim, full NAV recovered after the source returns — **no loss**) ·
`test_CF_C10_lastHolderFullExitDuringOutage_nothingStranded` · `test_CF_C10_outageExit_doesNotTouchCoDepositor`.
`RedTeamOnchainUnit.test_RT_5f_…everythingBricks_SUCCEEDS` re-shaped to `…availabilityPreserved_FIXED`.

**Residual.** `lastKnownIdle` is the LAST successful read: yield that accrued in the reserve after that read is
invisible during an outage, so an outage-time withdrawer burns marginally more shares per unit delivered than a live
read would (bounded by reserve yield since the last gateway action; conservative direction; they can simply wait).
A source that reverts on `deposit`/`redeem` but not on previews is unchanged (already best-effort via A-1).

## `harvestRecipient` timelocked rotation (Hacken F-02 rec. 3 / consolidated §4)

**Files.** `MintwareLpGatewayPositionManager.sol` (`harvestRecipient` storage, `pendingHarvestRecipient`,
`harvestRecipientEta`, `HARVEST_RECIPIENT_DELAY = 48 hours`, `proposeHarvestRecipient` / `acceptHarvestRecipient` /
`cancelHarvestRecipientRotation`, three events, `RotationNotReady` / `NoPendingRotation`). Factory + deploy script:
**no signature change** (the constructor still takes `harvestRecipient_`), so neither needed edits. ABI: rotation
functions/views/events added; `harvestRecipient` stays a view.

**Change.** The immutable recipient meant a USDG issuer freeze of the operator hot wallet (F-02b) had no on-chain
recovery for `harvest`/`deploy` (withdrawals were already unbricked by the best-effort LP leg, C-2). It is now
rotatable ONLY via propose → 48h → accept, all `onlyOwner`; cancel at any time; re-proposing restarts the clock.
**Invariant kept:** every sweep during the window still pays the CURRENT recipient — a compromised owner key
cannot redirect an in-flight fee stream; the operator has 48h to see `HarvestRecipientProposed` and cancel / rotate
the key.

**Tests added.** Unit (PM suite): `test_harvestRecipient_setAtConstruction` · `test_harvestRecipientRotation_happyPath_after48h` ·
`test_harvestRecipientRotation_earlyAccept_reverts` · `test_harvestRecipientRotation_cancel` ·
`test_harvestRecipientRotation_reproposeRestartsClock` · `test_harvestRecipientRotation_guards` (owner-only, zero
address, no-pending, pending-owner powerless). Fork: `test_CF_rotation_sweepsFollowRecipientOnlyAfterAccept`
(harvest AND the H-02 withdraw sweep → OLD during the window, NEW after accept; OLD frozen at its balance) ·
`test_CF_rotation_recoversHarvestAfterRecipientFreeze` (real blacklist quote freezes the recipient → `harvest`
reverts → rotate → 48h → `harvest` works, frozen address out of the fee path).

**Residual.** `acceptHarvestRecipient` is owner-only (per spec), not recipient-accepted — a typo'd proposal is
caught by the 48h window + cancel, not by a counter-signature. During the window a frozen recipient still blocks
`harvest`/`deploy` for up to 48h (by design — that IS the safety margin).

## Bytecode size (EIP-170) — ⚠ factory is tight

`forge build --sizes` after these changes: PM **16,331 B** runtime (8,245 B margin) · adapter 3,469 B · staging
2,176 B · **factory 23,631 B runtime — only 945 B of margin**. The factory embeds BOTH child creation codes, so
every byte added to the PM or staging lands in the factory twice over (initcode). The next PM feature of any size
will push the factory over 24,576 B → move to a deployer-split (`MintwareTreasuryDeployers` pattern) or CREATE2
child factories before adding more to the PM. Not blocking today; recorded so it isn't discovered at deploy time.

## Foundry CI (`.github/workflows/ci.yml`, `forge-tests` job only)

- Job env `LP_FORK_RPC_URL: https://rpc.testnet.chain.robinhood.com` (public, no secret); `timeout-minutes: 45`.
- Step 1 (unchanged semantics): `forge test -vv` with the env blanked → the full non-fork suite, what a
  contributor gets locally; must stay green independent of any RPC.
- Step 2: RPC preflight (`eth_chainId`, 5 attempts) → one clear `::error` if the public RPC is down.
- Step 3: fork suites, `--match-contract 'MintwareLpGateway(Hardening|AuditRound2|Closeout)Fork|RedTeamOnchainFork|HackenLpGateway'`,
  3-attempt outer retry loop; `continue-on-error` NOT set, so a real `[FAIL]` fails the job while RPC flakes get
  retried and reported distinctly. `forge --fork-retries` was NOT usable: it requires `--rpc-url`, which would fork
  every test in the repo (these harnesses `vm.createSelectFork` themselves). `MintwareLpGatewayForkTest` (the
  operator-runbook harness) is excluded — it needs the live rig's `LP_QUOTE_ASSET` etc.

## Gotchas hit while testing (for the next person)

- via-IR CSEs `block.timestamp` across `vm.warp` exactly like `block.number` across `vm.roll` — anchor clock math on
  an absolute literal (`T0`), never on a `block.timestamp` local.
- `vm.prank(x); pm.withdraw(pm.sharesOf(x))` pranks the VIEW call, not the withdraw → `InsufficientShares`. Read
  into a local first.
- Unicode (`≈`, `—`) inside Solidity string literals is a compile error; keep it in comments only.
