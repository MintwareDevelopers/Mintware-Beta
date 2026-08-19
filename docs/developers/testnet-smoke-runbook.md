# Testnet Smoke Runbook — converged YPN stack, end-to-end

> **One place to run the whole converged loop on testnet** and confirm it still works after the
> vault convergence + coverage gate + MEV + multi-venue changes. This **sequences tooling that already
> exists** (deploy scripts in `contracts-v4/script/`, the `*-ypn-v2-testnet` admin routes, and the Arc
> demo) into a single ordered checklist, and **adds the one step nothing covered yet**: the
> coverage-ratio gate (§ step 5).
>
> **Runnable, not run.** Everything below is gated on the operator setting keys/RPC in env. Nothing here
> broadcasts by itself. Companion detail: [`session-handoff-arc.md`](session-handoff-arc.md) (addresses,
> proofs, gotchas), [`arc-e2e-demo.md`](arc-e2e-demo.md) (the v1 Arc demo), and the audit dossier.

## 0. Prereqs

```bash
git checkout feat/ypn-vault-convergence     # (now on main too, dark-launched)
export PATH="$HOME/.foundry/bin:$PATH"
```

**Env the operator sets** (names only — never commit values; Foundry auto-loads root `.env`):

| Chain | Vars |
|---|---|
| Both | `DEPLOYER_PRIVATE_KEY` (**must be `0x`-prefixed** — foundry `vm.envUint`) |
| Base Sepolia | `BASE_SEPOLIA_RPC_URL` → use `https://base-sepolia-rpc.publicnode.com` (the `sepolia.base.org` node has a stale-mempool "replacement underpriced" bug) |
| Arc testnet | `arc` endpoint is pinned in `foundry.toml` (`https://rpc.testnet.arc.io`, chain `5042002`); faucet `https://faucet.circle.com` |
| Yield source | `ARC_YIELD_SOURCE=0x240Eb85458CD41361bd8C3773253a1D78054f747` (XyloVault — the fee-aware adapter handles its 10 bps exit fee; omit to fall back to the mock 4626) |
| Services (off-chain legs) | `EDGE_AUTH_URL`/`_SECRET`, `X402_PAY_TO`, relayer URL/secret — see [`deployments.md`](../.. /.claude/rules/deployments.md) |

> **Arc gotcha (do not re-learn):** `forge script --broadcast` throws a spurious `StackUnderflow` in the
> local EVM sim because Arc's USDC is a system contract at `0x3600…0000`. **Deploys** work with forge;
> **state-changing calls** (deposit/settle/deployToLP) must go via `cast send`, not `forge script`.

## 1. Baseline — the offline gates (no keys)

Confirm green before touching testnet:

```bash
pnpm forge:test                                   # full suite incl. invariants (pinned 256×128k)
FOUNDRY_PROFILE=deep pnpm forge:test              # optional: deeper invariant pass for sign-off
(cd services/edge-auth && cargo test)             # 86
(cd services/relayer && cargo test)               # 23
```

## 2. Deploy the converged stack

> ⚠ **Reconcile before running (real drift found 2026-08-18):** the `POST /api/admin/oracle/deploy-ypn-v2-testnet`
> route is **STALE** — it deploys the *pre-convergence* module-based vault (`setLiquidityModule`, route
> `route.ts:205`), but P2 consolidation **deleted `MintwareV4LiquidityModule`** and the converged
> `MintwareTreasuryVault` **self-holds** its V4 position (no module, no `setLiquidityModule`). **Use the
> Foundry `DeployTreasuryV2.s.sol` as the canonical converged deploy; do not smoke via that admin route
> until it's updated to the converged ABI.** (The v2 *smoke/commit/jit* admin routes take a `vault` address,
> so they work fine against a `DeployTreasuryV2`-deployed vault.)

| Leg | Command (canonical) | Notes |
|---|---|---|
| Converged YPN **v2** treasury vault | `forge script contracts-v4/script/DeployTreasuryV2.s.sol --rpc-url base_sepolia --broadcast --slow` | the senior/junior tranche vault that self-holds its V4 position + carries the coverage gate. Sets `setBaseFeePips` only — **no LVR/MEV wiring** (see gap (g)) |
| Multi-tenant factory (optional) | `DeployTreasuryFactory.s.sol` → `CreateTreasuryVault.s.sol` | per-team converged vaults (CREATE2, `onlyFactory`, two-phase ownership) |
| Arc YPN spend stack (v1 vault + gateway + adapter + CCTP router) | `forge script contracts-v4/script/DeployArcSpendStack.s.sol --rpc-url arc --broadcast --slow` | auto-uses real Arc USDC + CCTP; picks up `ARC_YIELD_SOURCE` (XyloVault). **Deploys the CCTP router but does not execute a bridge** — see gap (j) |
| Base Sepolia earn/collateral side | `DeployEthCollateralVault.s.sol` + `DeployEthSettlement.s.sol` | ETH → USDC settlement path (`requireReadyOracle` true → settlements revert until an oracle hook is wired) |

> **Not wired to npm:** none of `DeployTreasuryV2` / `DeployTreasuryFactory` / `CreateTreasuryVault` /
> `DeployArcSpendStack` / `LiveSettleArc*` / `DeployEth*` have a `package.json` target — run them by hand
> as above (each file's natspec has the exact invocation). Adding `forge:deploy:treasury:*` targets is a
> cheap follow-up. (Also note: the `forge:deploy:phase3:*` npm targets are **broken** — `DeployPhase3.s.sol`
> was removed with the shelved Phase-3.)

Record the deployed addresses (repoint `config/arc.ts` `ARC_TESTNET_DEPLOYMENT` + `NEXT_PUBLIC_ARC_*`).

## 3. Deposit → earn (senior side)

`POST /api/admin/oracle/smoke-ypn-v2-testnet` (or the equivalent `cast send`): deposit senior USDC,
confirm it idles into the yield adapter and shares mint. **Assert:** `totalSeniorAssets` rose,
`coverageBps() == type(uint256).max` (nothing deployed yet).

## 4. Team / junior commit + deployToLP

`POST /api/admin/oracle/commit-team-ypn-v2-testnet`: commit team tokens + the junior USDC buffer, then
`deployToLP`. **Assert:** `deployedFromSenior > 0`, `coverageBps()` is now finite and healthy.

## 5. ⭐ Coverage-ratio gate (NEW — the gap this runbook fills)

Nothing pre-existing smoke-tests the coverage gate (`66e3f59b`). This runbook ships a smoke script for it —
[`contracts-v4/script/SmokeCoverageGate.s.sol`](../../contracts-v4/script/SmokeCoverageGate.s.sol) — run as a
**fork simulation** (no broadcast, no gas, repeatable) against a deployed converged vault:

```bash
TREASURY_VAULT=0x<deployed converged vault> pnpm forge:smoke:coverage-gate
```

It forks the live chain, pranks the vault owner, and asserts: (1) gate off by default, (2) `deployToLP`
reverts `CoverageTooLow` when the floor is above current coverage, (3) the same deploy proceeds once the
floor is lowered below the post-deploy coverage — mirroring `test_coverage_gate_*` on the *deployed*
instance. (Requires the vault activated + `deployedFromSenior > 0`, i.e. steps 3–4 first; it self-skips
with a clear message otherwise.)

> **✅ Proven live (2026-08-18, Base Sepolia).** Deployed a fresh converged vault via
> `SoakAmAmmDeploy.s.sol` (self-contained: mock USDC/TEAM/adapter + `commitTeam` + `deployToLP`) to
> **`0xf10c970157928E7984987302c415D2f296a8Aa01`** (`coverageBps=50000`, `deployedFromSenior=1e9`,
> `juniorUsdcBuffer=5e9`) and ran this smoke against it — `PASS`: reverts `CoverageTooLow` at floor 50001,
> proceeds at floor 25000 (`coverageBps after=49504`). The gate works on-chain. (`SoakAmAmmDeploy` is the
> quickest self-contained way to stand up a coverage-smoke-ready vault — no external team-token/adapter.)

For a **live broadcast** on Base Sepolia (real state change) rather than a sim, the equivalent `cast` sequence:

```
# reads (view) — via cast call
coverageBps()                      # finite, = juniorUsdcBuffer*10000/deployedFromSenior
minCoverageBps()                   # 0 by default (gate off)

# 1. set a floor just above current coverage
setMinCoverage(<covNow + 1>)       # cast send, onlyOwner

# 2. a further deployToLP MUST revert CoverageTooLow (the gate halts risk-increasing growth)
deployToLP(<small amount>, jt)     # expect revert: CoverageTooLow

# 3. lower the floor and confirm the same deploy proceeds
setMinCoverage(<covNow>)           # cast send
deployToLP(<small amount>, jt)     # succeeds; coverageBps stays >= floor

# 4. reset
setMinCoverage(0)
```

**Assert:** step 2 reverts with `CoverageTooLow`, step 3 succeeds, and `coverageBps()` never drops below
the active floor. (This mirrors the `test_coverage_gate_*` Forge tests, on live testnet.) Because Arc's
USDC breaks forge sim, drive these with `cast send` / `cast call`, and check the revert via the tx status.

## 6. JIT provision on a swap

`POST /api/admin/oracle/jit-smoke-ypn-v2-testnet`: run a swap through the hooked pool and confirm the JIT
borrow → provision → settle path fires. **Assert:** senior NAV unchanged (JIT is junior-backed), the JIT
leg is zero at rest, and — if `minCoverageBps > 0` — `borrowIdleForJit` **skips** when the cushion is thin
(returns 0, no revert of the user swap).

## 7. Spendable gateway — settle a card spend

EIP-712 `DelegatedSpendPermit` → `setCircleCpnTreasury(merchant)` (admin) → `settleSpend(...)` (relayer) →
shares burn, merchant paid in USDC. **Assert:** deployer `shares(user)` dropped by the assets, merchant
USDC rose by the same. `LiveSettleArc.s.sol` is the reference for building/signing the permit.

> ⚠ **On Arc, settle via `cast send` — NOT `forge script`.** Forge's local EVM mis-simulates Arc's
> system-contract USDC (`0x3600…0000`) and reverts with a spurious `StackUnderflow`; **`--skip-simulation`
> does NOT help** (verified 2026-08-18 — forge still traces locally). `cast send` gas-estimates on the real
> node, which executes the withdraw/settle path correctly. Build the permit sig with `cast` and send:
> ```bash
> DS=$(cast call $GATEWAY "domainSeparator()(bytes32)" --rpc-url arc)
> TH=$(cast keccak "DelegatedSpendPermit(address user,uint256 maxDailySpendUSDC,uint256 nonce,uint256 deadline)")
> DEADLINE=$(( $(cast block latest -f timestamp --rpc-url arc) + 3600 ))
> SH=$(cast keccak $(cast abi-encode "f(bytes32,address,uint256,uint256,uint256)" $TH $USER 1000000000 1 $DEADLINE))
> SIG=$(cast wallet sign --no-hash --private-key $KEY $(cast keccak $(cast concat-hex 0x1901 $DS $SH)))
> cast send $GATEWAY "setCircleCpnTreasury(address)" $MERCHANT --rpc-url arc --private-key $KEY
> cast send $GATEWAY "settleSpend(bytes32,address,uint256,address,(address,uint256,uint256,uint256),bytes,(bytes32,address,uint256,uint256,uint256),bytes)" \
>   $HOLDID $USER 2000000 $MERCHANT "($USER,1000000000,1,$DEADLINE)" $SIG "($ZERO32,$ZERO,0,0,0)" 0x --rpc-url arc --private-key $KEY
> ```
> The permit nonce is **revocation-only** (checked, never consumed), so a working nonce is reusable.

> **✅ Proven live (2026-08-18, Arc testnet).** settleSpend tx
> **`0xfdf7031325a6c3622d28953cb88b145ef317a23ae37ddf24dca10144b221695e`** — burned 2 USDC of vault
> `shares` (deployer `3e6 → 1e6`) and paid the merchant **2 USDC** (`0 → 2e6`) on Arc. `PaymentSettled`.

## 8. CCTP Base → Arc bridge

Burn USDC on Base (TokenMessenger `depositForBurn`, `mintRecipient` = the Arc CCTP router) → wait for
Circle attestation (~15 min at standard finality, `maxFee=0`) → relayer `receiveAndDeposit` on Arc.
The **destination half** (attestation poll + `receiveAndDeposit` + assert) is scripted:

```bash
BURN_TX=0x<base burn tx> RECIPIENT=0x<who gets the shares> \
  ./scripts/cctp-bridge-smoke.sh
```

It polls Circle's iris API (`/v2/messages/6?transactionHash=…`, Base domain **6**, Arc domain **26**),
then `cast send`s `receiveAndDeposit(message, attestation, recipient)` on Arc and **asserts** the recipient's
vault shares rose (the bridged dollar landed as **yield-earning shares**). The **source burn** is Circle's
standard `TokenMessenger.depositForBurn` — the script deliberately does not hardcode a burn address; use your
existing burn flow. Find your burn by **tx hash** (the public TokenMessenger is shared across chains).

## 9. Live authorization off Arc NAV (off-chain leg)

Point edge-auth at Arc (`services/edge-auth/.env.arc.example`) and hit `POST /authorize`: a within-NAV
charge approves in ~10 ms; an over-NAV charge declines. **New (this session):** with the operator gates set
(`MemStore::set_liquidity_reserve` / `set_breaker`), confirm a charge that would breach the hot-buffer floor
declines `reserve_floor_breached`, and that an open breaker declines `circuit_breaker_open` (both off by
default). `GET /available/:user` reflects `NAV − holds − cap − liquidity − reserve`.

## Coverage map — what each step proves

| Money-path step | Tooling | Pre-existing smoke? |
|---|---|---|
| (a) Deploy converged vault/factory | `DeployTreasuryV2.s.sol` (canonical) · `DeployTreasuryFactory`+`CreateTreasuryVault` | ✅ (⚠ the `deploy-ypn-v2-testnet` route is stale — §2) |
| (b) Senior deposit → earn | `smoke-ypn-v2-testnet` (`depositUSDC`) | ✅ |
| (c) Team/junior commit | `commit-team-ypn-v2-testnet` (`commitTeam`) | ✅ |
| (d) deployToLP | `smoke-ypn-v2-testnet` (optional) · `SoakAmAmm*` | ✅ |
| (e) JIT provision on swap | `jit-smoke-ypn-v2-testnet` (real swap → `sweepJit` → `jitNetPnl`) | ✅ |
| **(f) Coverage-ratio gate** (`setMinCoverage`/`CoverageTooLow`) | **§5 (this runbook)** | ❌ **NO tooling references it — added here** |
| **(g) Diamond-LVR / MEV on the YPN vault** | am-AMM+surge/dynamic wired only on the **DeFi pair vault** (`deploy-pair-full-testnet`, `SoakAmAmm*`) | ❌ **not on the YPN treasury vault** — `DeployTreasuryV2` sets `setBaseFeePips` only; `lvrSurchargePips` set nowhere |
| **(h) Multi-venue yield adapter** | — | ❌ **no deploy/rebalance anywhere** — 12 unit tests only; needs a 2nd live venue |
| (i) Spendable gateway settle | `smoke-ypn-v2-testnet` · `LiveSettleArc(HighValue)` · `arc-e2e-demo.md` | ✅ |
| **(j) CCTP Base→Arc bridge** | `DeployArcSpendStack` deploys the router but **never drives `receiveAndDeposit`** | ⚠ **deploy-only** — proven manually once (tx `0x3e7734cf…`), no repeatable script/route |
| (k) Arc live settle | `LiveSettleArc.s.sol` ($2) · `LiveSettleArcHighValue.s.sol` ($300, edge-signed) | ✅ |
| Live authorize (NAV + new spend-safety gates) | edge-auth `/authorize` + `/available` | ✅ core · ❌ reserve-floor/breaker (new) → §9 |

## Known-gaps to close before calling the loop "fully smoked"

The map found **four** money-path steps with no repeatable testnet coverage — this runbook adds steps for (f) and the edge gates (§9); (g)/(h)/(j) need a small build:

- **(f) Coverage-ratio gate** + **§9 reserve-floor/circuit-breaker** — new levers this session; §5/§9 are the first on-chain exercise.
- **(g) Diamond-LVR / MEV on the YPN treasury vault** — the MEV engine is only wired on the DeFi *pair* vault; the YPN `MintwareTreasuryJitHook` sets no LVR surcharge. Add a `setLvr`/`setSurgeParams` wiring step to `DeployTreasuryV2` (or a dedicated route) to smoke it on the treasury path.
- **(h) Multi-venue adapter** — nothing deploys `MintwareMultiVenueYieldAdapter` or calls `setVenues`/`rebalance`; needs a second live venue (a Morpho/Euler 4626 on the target chain) before it's smoke-able.
- **(j) CCTP bridge execution** — the router is deployed but no script/route drives the Base→Arc burn → attest → `receiveAndDeposit`; a `LiveBridgeArc.s.sol` (or relayer smoke) would make it repeatable.
- **Stale `deploy-ypn-v2-testnet` route** — deploys the deleted module-based vault; update it to the converged ABI or retire it (§2).

Everything remains **testnet + unaudited**; external audit gates real value (see the audit dossier).
