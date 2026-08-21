# Mintware Self-Assessment Checklist (SCSVS + SWC + Solcurity + DeFi classes)

> Consolidated from public standards: **SCSVS v2** (Smart Contract Security Verification Standard),
> the **SWC Registry** (weakness classes), **Solcurity** (engineer's line-by-line list), and
> **DeFi-specific vulnerability classes** the standards under-weight. Apply every relevant item to the
> assigned contracts. This is a **SELF-REVIEW, not an external audit.**

For each item below, assign a verdict for the assigned contracts:
- **PASS** — clearly handled; cite file:line evidence.
- **PARTIAL** — handled but with a caveat/gap; explain.
- **GAP** — not handled / a real concern; explain and rank severity.
- **N/A** — not applicable to these contracts; say why.

Then list concrete **findings** ranked **Critical / High / Medium / Low / Info**, each with file:line, the
failure scenario (inputs → bad outcome), and a fix. Be adversarial — try to break it. Do NOT rubber-stamp;
"PASS everything" on a 800-line money contract is a red flag in itself.

---

## A. SCSVS categories

- **A1 Architecture & threat model** — trust boundaries clear? Privileged roles enumerated? Upgrade/kill paths understood?
- **A2 Access control** — every state-changing / privileged fn gated (onlyOwner/onlyHook/onlyPoolManager/role)? No missing modifier? Two-step ownership? Can a privileged role move USER funds (custody red line)?
- **A3 Business logic** — does the code do what the NatSpec claims? Invariants stated & held? Edge cases (0, max, empty, single-user)?
- **A4 Arithmetic** — over/underflow (unchecked blocks justified?), precision loss, **rounding direction** (must favor the vault/protocol, never the withdrawer), division-before-multiply, mulDiv correctness, share/asset conversion.
- **A5 Denial of service** — unbounded loops, griefing via revert-on-transfer, gas-limit blowups, queue/withdrawal DoS, a single actor bricking a shared path.
- **A6 External calls & reentrancy** — CEI ordering; `nonReentrant` coverage; **cross-function** and **read-only reentrancy**; state written after external calls; untrusted callee.
- **A7 Oracle / price** — spot vs manipulation-resistant; TWAP/truncated-oracle correctness; can a swap in the same block move the reference? Circuit-breaker deadlock/heal.
- **A8 Signatures & replay** — EIP-712 domain correctness; nonce/deadline; replay across chains (chainid) / actions / accounts; signature malleability; permit handling.
- **A9 Gas & economic** — fee math bounds; incentive alignment; can an attacker make an action uneconomic or extract value?
- **A10 Upgradeability** — proxy storage layout, initializer protection, `_disableInitializers`, delegatecall safety, storage collisions.
- **A11 Token handling** — ERC-20 return-value checks (SafeERC20), **fee-on-transfer / rebasing** (balance-diff accounting), approval race / infinite approval, ERC-4626 inflation, ERC-6909 claim accounting.
- **A12 Governance / keys** — admin powers scoped & timelocked? Guardian pause? Oracle/relayer keys unable to touch principal? Centralization risks disclosed.

## B. SWC classes (sweep — did we AVOID each?)

SWC-101 int over/underflow · 104 unchecked call return · 105/106 unprotected withdraw/selfdestruct · 107 reentrancy · 112 delegatecall to untrusted · 113/128 DoS (revert / gas) · 114 tx-order dependence (front-running) · 115 tx.origin auth · 116 timestamp dependence · 117/121/122 signature issues (malleability, replay, missing protection) · 118 incorrect constructor · 119 shadowing · 120 weak randomness · 123 requirement violation · 124 write to arbitrary storage · 125 incorrect inheritance order · 131 unused vars · 132 unexpected ether balance · 134 message-call-with-hardcoded-gas · 135 code-with-no-effects · 136 unencrypted secret. (Flag any that apply.)

## C. Solcurity engineer checks

- Return values of low-level `call`/`transfer`/`send` checked.
- `SafeERC20` (or equivalent) for all token moves; no bare `transfer`/`transferFrom` on arbitrary tokens.
- Zero-address / zero-amount validation on inputs & setters.
- Events emitted on every state change (esp. privileged setters).
- `immutable`/`constant` where possible; no accidental mutable admin.
- No unbounded/user-controlled loops.
- CEI everywhere; state mutated before external calls.
- `nonReentrant` on every externally-callable state-changing fn that makes an external call.
- No `tx.origin`; no `block.timestamp`/`blockhash` for critical logic or randomness.
- Pragma pinned (not floating); no deprecated opcodes.
- `delegatecall` targets trusted & storage-compatible.
- Struct/array bounds; no OOB; no uninitialized storage pointers.
- Error messages / custom errors present; no silent failure that hides a real revert.

## D. DeFi-specific classes (the ones that actually drain protocols)

- **D1 First-depositor / share inflation** — virtual offset or min-liquidity present? Can a donation before first deposit inflate share price?
- **D2 Solvency / NAV conservation** — can total redeemable exceed backing? Senior par (1:1 USDC) always covered? Does yield-adapter fee/loss get double-counted or over-reported (over-stated NAV)?
- **D3 Donation / balance-diff** — does the contract trust `balanceOf` (donation-manipulable) or use internal accounting / balance-diff?
- **D4 JIT / LVR / MEV** — JIT gating & fallback safety; LVR recapture correctness; can MEV bot exploit the fee/oracle path; sandwichable sweeps.
- **D5 Callback authorization** — V4 hook callbacks (`beforeSwap`/`afterSwap`/unlock) authenticated (`onlyPoolManager`, sender==vault)? Pool-binding (a callback for pool A can't act on pool B)? (Cork-style callback-auth class.)
- **D6 Rounding-conservation** — all mulDiv round toward the vault; Σ pro-rata ≤ backing; no dust leak that accumulates.
- **D7 Withdrawal queue / lock** — lock-tier math, early-exit penalty, async redeem, no way to bypass the cliff or grief the queue.
- **D8 Fee-on-transfer / hostile token** — hostile adapter / hostile token callback path defended (balance assertions, reentrancy).
- **D9 Emergency posture** — guardian pause reachable; pause can't itself brick redemptions/withdrawals unfairly; recall path stays open when paused.
- **D10 Cross-contract trust** — factory/registry/deployer front-running (CREATE2 salt), onlyFactory, two-phase ownership; adapter allowlist + timelock.

## E. Meta

- **E1 Test coverage** — invariants for the money-loss paths? Fork tests for external integrations?
- **E2 Dead code / stale** — deprecated contracts still deployable? Dead attestation/no-op paths that mislead?
- **E3 Documentation vs code** — does NatSpec/README match behavior? Any comment that lies?
