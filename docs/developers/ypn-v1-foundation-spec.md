# YPN v1 Foundation — Implementation Spec

**Scope:** the on-chain settlement foundation for the Mintware Yield Payment Network — impl-order
steps 1–2 of the handoff brief. Three contracts + a 256×128k invariant suite. This is **custody /
money-path** code (it moves user USDC on a relayer's call). Correctness > everything.

**Target:** builds + fuzzes on **Base Sepolia** over the fork-proven `AaveV3YieldAdapter` (real Aave).
OZ `EIP712` reads `block.chainid` — the domain is correct per chain automatically; the brief's Arc
`chainId 5042002` is the documented Arc target, NOT a hardcoded literal. Arc lands later behind the
same yield-adapter seam.

## 0. Architecture — `IYieldVault` is the contract boundary

```
MintwarePaymentGateway ──talks only──▶ IYieldVault { idleBuffer, previewWithdraw, burnForPayment }
                                            │
                            v1 ──▶ MintwareYieldVault  (single-asset USDC, implements it natively)
                            v2 ──▶ MintwarePaymentAdapter → treasury-anchored ULV  (later, same seam)
```

v1 does NOT build the adapter — `MintwareYieldVault` implements `IYieldVault` directly. The seam IS
the interface; v2 swaps the vault behind it with zero Gateway change.

## 1. `IYieldVault.sol`
```solidity
interface IYieldVault {
    function previewWithdraw(uint256 assets) external view returns (uint256 shares);
    function burnForPayment(address user, uint256 shares, address receiver) external returns (uint256 assetsRedeemed);
    function idleBuffer() external view returns (uint256);
}
```

## 2. `MintwareYieldVault.sol` — single-asset USDC, NAV-stable, over the Aave adapter
An ERC-4626-style USDC vault whose idle assets sit in Aave via `IYieldAdapter`. NOT dual-sided, NO
JIT, NO oracle — price-free by construction (one asset).

- **State:** `IERC20 usdc` (immutable, 6dp), `IYieldAdapter adapter` (immutable, wraps aUSDC), `address gateway` (set-once), `mapping(address=>uint256) shares`, `uint256 totalShares`. Ownable/Pausable.
- **`totalAssets()`** = `adapter.totalAssets()` + `usdc.balanceOf(this)` (Aave principal+interest + any un-supplied buffer). aTokens rebase ⇒ interest accrues with zero bookkeeping.
- **Inflation defense:** ERC-4626 **virtual assets + virtual shares** offset (OZ 4626 `_decimalsOffset` style, or a fixed `VIRTUAL = 1e3`), so the first-depositor / donation inflation attack is impossible. Document the exact offset.
- **`deposit(uint256 assets, address to)`** → pull USDC (`safeTransferFrom`), `adapter.deposit(assets)` (idle into Aave), mint `shares = assets * (totalShares+V) / (totalAssets_before+V)` (round DOWN, favors vault), credit `to`. `nonReentrant whenNotPaused`. Emit.
- **`previewWithdraw(uint256 assets) → shares`** — shares needed to cover `assets`, **round UP** (`mulDivUp`): `shares = ceil(assets * (totalShares+V) / (totalAssets+V))`. Rounding UP guarantees `burnForPayment` redeems ≥ `assets` (the Gateway asserts `redeemed ≥ assets`).
- **`burnForPayment(address user, uint256 shares, address receiver) → assetsRedeemed`** — **`onlyGateway` `nonReentrant whenNotPaused`.** The Gateway is the sole authority (it verified the user's EIP-712 permit off-chain); the vault trusts it and burns the *user's* shares custodially, NO on-chain user approval. Steps: (1) `require shares ≤ shares[user]`; (2) `assetsRedeemed = shares * (totalAssets+V) / (totalShares+V)` round DOWN (favor vault); (3) burn: `shares[user] -= shares; totalShares -= shares` (EFFECTS before external — CEI); (4) `got = adapter.withdraw(assetsRedeemed)` (best-effort); (5) `require got ≥ assetsRedeemed` else revert `InsufficientIdleLiquidity` (the Gateway's idleBuffer pre-check should make this rare, but enforce it); (6) `usdc.safeTransfer(receiver, assetsRedeemed)`. Emit `PaymentBurn`.
- **`idleBuffer() → uint256`** = `min(adapter.totalAssets(), adapter.maxWithdrawable())` — the USDC actually withdrawable from Aave right now (respects Aave availability). The Gateway checks this before approving.
- **User-initiated `redeem(shares)`** — a normal redeem path for depositors (not the payment path): burn shares → withdraw USDC → to `msg.sender`. Needed so deposits are honestly liquid; same math, `msg.sender` only.
- **`setGateway(address)`** — `onlyOwner`, set-once (or owner-updatable with an event; set-once is safer). `pause`/`unpause`.

## 3. `MintwarePaymentGateway.sol` — finalize the brief's contract
Start from the brief's contract. Apply these REQUIRED fixes/reviews:

1. **NONCE = REVOCATION-ONLY (critical fix).** The brief consumes `usedNonces[user][permit.nonce]` on every `settleSpend`, which makes the *long-lived* permit single-use — the 2nd spend reverts `NonceAlreadyUsed`. **Remove the `usedNonces[user][permit.nonce] = true;` line from `settleSpend`.** Keep the `if (usedNonces[...]) revert` CHECK (rejects revoked permits). Replay of a specific charge is stopped by `holds[holdId].settled`; over-spend by the daily cap. `revokeNonce` remains the only writer of `usedNonces`.
2. **Edge-auth nonce:** the `ShortLivedHoldAuth.nonce` is bound to `holdId` + `expiry`; the holdId `settled` flag already prevents replay. Do NOT consume it either (keep it as a uniqueness field). Confirm the holdId binding (`edgeAuth.holdId == holdId`) is enforced (it is).
3. **CEI:** `holds[holdId]` write + `_checkAndUpdateDailyLimit` MUST happen before `vault.burnForPayment` (external). Confirm the ordering; `nonReentrant` is present — keep it.
4. **`burnForPayment(user, sharesBurned, address(this))`** then `usdc.safeTransfer(receiver, assets)` — the vault sends USDC to the Gateway, Gateway forwards. This is fine; alternatively pass `receiver` straight to `burnForPayment` and drop the forward (one less hop). Pick one; keep it minimal. The vault must end with zero residual USDC from this call.
5. **`assets` vs `assetsRedeemed`:** `previewWithdraw(assets)` (round up) → `burnForPayment` → `redeemed`; assert `redeemed ≥ assets`. Transfer exactly `assets` to the receiver (the tiny `redeemed − assets` dust stays in the vault as extra backing — vault-favoring). Confirm.
6. **Daily cap:** `effectiveCap = min(permit.maxDailySpendUSDC, userDailyCap|DEFAULT_GLOBAL_DAILY_CAP)`, per `epochDay`. Keep.
7. Keep AccessControl roles (RELAYER/EDGE_SIGNER/PAUSER/ADMIN), Pausable, the hybrid ≥$250 edge rule, and the domain `("Mintware Payment Gateway","2.0")`.

## 4. Invariant + unit suite (the gate — write invariants FIRST)
Handler drives: deposits, user redeems, and `settleSpend` flows (valid permits, ≥$250 edge-signed, invalid/forged sigs, revoked nonces, over-cap, over-buffer, replayed holdIds) against the real `MintwareYieldVault` over a mock Aave (tunable/illiquid) + hostile-token/hostile-relayer/hostile-edge mocks.

1. `invariant_vault_solvency` — `totalAssets() ≥ Σ (shares[u] × NAV)` for all holders (Aave-backed). Never under.
2. `invariant_settlement_conserves` — every `burnForPayment` redeems ≥ the requested assets; the vault never sends more USDC than it withdrew; no value created.
3. `invariant_nav_monotonic` — share price (assets/share) never DECREASES except by realized yield loss; deposit/redeem/burnForPayment do not move it (inflation-safe).
4. `invariant_no_unauthorized_settlement` — **the §5 property:** a handler wielding RELAYER + EDGE_SIGNER but NO valid user permit signature can NEVER reduce any user's shares or move USDC. Model hostile relayer+edge; assert user balances only change with a genuine permit sig.
5. `invariant_permit_reusable_and_bounded` — a single valid permit settles MANY spends (nonce not consumed), is revocable (post-revoke settle reverts), daily-cap-bounded, and a given holdId settles at most once.
6. `invariant_rounding_favors_vault` — deposit→redeem round-trip never returns more than contributed + yield; `previewWithdraw` never under-quotes shares.

Each at **256 runs × 128,000 calls, 0 reverts**. Plus focused unit tests: the ≥$250 path rejects a missing/forged edge sig; the <$250 path needs only the permit; daily cap (protocol + permit) enforced; `idleBuffer` gates approval; `burnForPayment` is `onlyGateway`; a revoked nonce blocks settlement; a replayed holdId reverts; the permit settles twice successfully (the nonce-fix regression test).

## 5. Build order & discipline
1. `IYieldVault` + `MintwareYieldVault` (+ virtual-share inflation defense) → unit tests green.
2. Finalize `MintwarePaymentGateway` (the nonce fix + reviews) against the real vault → unit tests green.
3. Invariant suite → 256×128k, 0 reverts.
4. `forge build` + full `forge test` green. Commit, do NOT push. Human (me) reviews every line + re-runs the gate before anything lands.

## Guardrails
- No oracle / price anywhere (single asset). Round every division toward the vault. `burnForPayment` `onlyGateway`. CEI on every external call. Best-effort adapter withdraw + assert-sufficient. Virtual shares for inflation. The nonce is revocation-only. Do not weaken any assertion to make a test pass — fix the code.
