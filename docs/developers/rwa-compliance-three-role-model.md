# RWA Compliant Pool Structure — Three-Role Model

**Status:** Decision of record for the RWA secondary-liquidity structure. **Draft — for counsel
review.** Adopted 2026-08-05 to resolve the legal/compliance setback on the RWA surface.
**Applies to:** Reg D-issued assets (current LiquidHectar / private-credit / real-estate tier).
**Not built yet** — this is the target compliance architecture; the current on-chain code diverges
(see §5). Do not present any of this on customer-facing surfaces until counsel clears it.

Related: [**Build Plan of Record**](rwa-three-role-build-plan.md) (contracts + KYC stack + sequencing) ·
[Vaults & RWA Build Spec](vaults-rwa-build-spec.md) · [Two-Surface Architecture](phase3-two-surface-architecture.md) ·
[RWA Go-Live Runbook](rwa-golive-runbook.md).

---

## 1. The structure

Three roles, and the compliance check sits on exactly one of them — the trader, at the moment of
receipt — and nowhere else.

```
        LPs                          POOL                        TRADERS
   (public, USDC only)      (Uniswap V4, both sides)       (KYC-gated on receipt)
┌──────────────────┐                                      ┌──────────────────────┐
│  Anyone, anywhere │                                      │  Must be whitelisted  │
│  deposits USDC    │──── USDC ───┐              ┌── vRWA ─│  to receive vRWA on   │
│  into the ULV      │             │              │         │  a swap               │
│                    │             ▼              ▼         │                       │
└──────────────────┘   ┌─────────────────────────────────┐ └──────────────────────┘
                        │     MINTWARE ULV POOL           │
                        │   (MintwareDeFiVault4626 /       │
                        │    normal V4 pool, no RFQ,       │
                        │    no auction, no routing hack)  │
                        │  USDC side: public liquidity     │
                        │  vRWA side: issuer-supplied      │
                        │  inventory, custodied by the pool│
                        └─────────────────────────────────┘
                                       ▲
                                       │ vRWA inventory
                        ┌─────────────────────────────────┐
                        │   RWA PROVIDER / ISSUER          │
                        │   (already whitelisted, same as  │
                        │    any other permitted holder)   │
                        └─────────────────────────────────┘
```

**LPs — USDC only.** Public, permissionless, no KYC. LPs deposit and withdraw USDC-denominated
value. They never receive, hold, or transact in vRWA at any point — the pool contract does, on their
behalf, as normal AMM mechanics. This is the structural fact that keeps LPs out of the
token-transfer-restriction problem: they are never a party to a transfer of the restricted security,
so the security's transfer restrictions never attach to them.

**Pool — standard Uniswap V4 pool, unmodified mechanics.** Holds both sides as normal inventory:
public USDC on one side, issuer-supplied vRWA on the other. No RFQ layer, no Dutch auction, no forced
same-block routing. The pool contract is registered as a permitted holder against the token's
identity registry — the same status any other whitelisted party (the issuer, a market maker) has.
This preserves full mobility and instant execution — the thing the RWA "mobility, not tokenization"
thesis depends on.

**Traders — the only humans who are checked, and only at the moment of receipt.** `beforeSwap`
verifies the trader's wallet against the identity registry before releasing vRWA to them. USDC-side
legs of a trade require no check. Nothing else in the system requires verification — not deposit, not
LPing, not holding vault shares.

---

## 2. Role summary

| Role | Gated? | Basis |
|---|---|---|
| LP (USDC in/out) | No — open to anyone* | Never a party to a transfer of the restricted security; token restriction doesn't attach |
| Pool (Uniswap V4 contract) | Yes — whitelisted once, like the issuer | Holds vRWA as inventory; must be a permitted holder under the token's transfer rules |
| Trader (buying/selling vRWA) | Yes — checked per trade, on receipt only | Direct recipient of the restricted security; where the Reg D restriction actually applies |

\* Subject to the open Investment Company Act question in §4 — "anyone" may become "qualified
purchaser" on the LP side.

---

## 3. What this replaces (rejected approaches)

The three-role model supersedes three earlier proposals, all rejected. It doesn't try to relabel or
reroute anything — it puts the compliance check exactly where the legal restriction lives (delivery
of the security, to the person receiving it) and nowhere else.

| Rejected approach | Why it was wrong |
|---|---|
| Synthetic "receipt" token (Tier 1 / Tier 2 wrapper) | Relabeling a claim on a security doesn't change its substance under Howey / SEC "economic reality" analysis. Cosmetic, not structural. |
| RFQ / Dutch-auction routing to keep the vault "single-sided" | Technically avoids the vault holding inventory, but destroys instant execution — trades away mobility (the whole RWA thesis) for a compliance benefit that's still unresolved (whoever absorbs the inventory just inherits the exposure). |
| Marketing yield as "DEX trading fees" instead of "real estate yield" | Same labeling problem. Where the fee revenue actually comes from (demand to trade a security-backed asset) doesn't change because the frontend calls it something else. |

---

## 4. Open item for counsel — Investment Company Act exposure

**This is a different statute** from everything else discussed (Securities Act / Reg D transfer
restrictions; Exchange Act / broker-dealer registration). Even with LPs fully insulated from the
token-transfer problem, pooling public USDC into a vehicle that the pool contract actively deploys
into securities (via the vRWA/USDC pair) may itself require registration as an investment company —
unless a valid exemption applies.

**Precedent already in Mintware's own market-comparison table:** Ondo's OUSG is explicitly structured
as a **3(c)(7) fund** — a standard Investment Company Act exclusion requiring investors to be
**qualified purchasers** (a materially higher bar than "accredited," and much higher than "anyone").

**The question for counsel, stated precisely:**

> Does a USDC-only ULV — where the pool contract is the sole custodian of RWA inventory and LPs never
> receive the underlying security directly — fall outside Investment Company Act scope because LPs
> never take delivery of the security? Or does it still require a 3(c)(1)/3(c)(7)-style exemption
> because the vehicle itself is pooling capital for deployment into securities, the same way Ondo's
> OUSG does?

**Why it matters for "LPs = anyone":** if the answer is "still needs 3(c)(7)," the LP side has a
ceiling — qualified-purchaser status — even though the token-transfer problem is fully solved. That's
a different, probably more workable, constraint than per-trade KYC, but it is still a constraint.
"Anyone, no gating at all" on the LP side is not achievable until this is answered.

**Engineering consequence:** the trader-gating and pool-as-permitted-holder work (§5, items 2–3) is
safe to build regardless of the answer. The LP deposit path (item 1) must stay parameterized so a
qualified-purchaser gate can be switched on if counsel requires it — do not hard-code "open to
everyone" on the LP side.

### Scope note — Reg D only

This structure applies to **Reg D-issued assets** (current tier). It is **not needed** for assets
issued under Reg A+ or an equivalent public-offering exemption, where no transfer restriction exists
in the first place and the pool can run fully open on both the LP and trader side.

---

## 5. Current code vs this model (gap analysis, 2026-08-05)

The current on-chain model is **"permissionless everything, KYC only at redemption."** This target
model is **"gate the trader at receipt, register the pool as a permitted holder, keep the LP side
open but USDC-only."** Three divergences to close:

**1. Deposit currently mints vRWA to the depositor — the exact thing this model forbids.**
`MintwareRWAVault4626`'s `asset()` is USDC, but `_afterEnter()`
(`contracts-v4/src/rwa/MintwareRWAVault4626.sol:182`) calls `vrwa.mint(receiver, shares)` on every
deposit, so an LP walks away holding vRWA. The current contract is really a "wrap USDC→vRWA" vault,
not a USDC liquidity vault. The target ULV: LP deposits USDC, receives USDC-denominated vault shares,
**never** vRWA; the pool's vRWA inventory comes from the issuer, not from minting to depositors. (The
existing wrap vault can serve as the issuer-side wrapping mechanism that supplies pool inventory.)

**2. Traders are not gated.** `MintwareOracleHook.beforeSwap()`
(`contracts-v4/src/rwa/MintwareOracleHook.sol:164`) enforces only price bands + fee; it ignores the
swapper address and holds no registry reference. The target requires a `beforeSwap` identity check
against `SPVBeneficiaryRegistry` on the **vRWA-out leg only** (USDC-out legs stay unchecked).

**3. The pool is not a registered permitted holder.** `MintwareVRWA.transferMode` defaults to
`PERMISSIONLESS`, so the pool holds inventory with no allowlist entry, and the registry is only
consulted in `confirmSettlement()` at redemption. The target enrolls the pool (PoolManager address)
as a permitted holder and moves the check to the trade boundary.

The building blocks already exist — `SPVBeneficiaryRegistry` (KYC tiers), `MintwareVRWA`'s
`WHITELISTED` transfer mode + 48h timelock, the vault-only LP gate in the hook. They are wired to the
wrong boundary (redemption) and currently inert (permissionless mode). Closing the gap is a rewiring +
one new USDC-only vault, not a greenfield rebuild.

---

## 6. Canonical summary line

Three-role model for RWA secondary liquidity: **LPs USDC-only and ungated** (never touch the
restricted security), **the pool is a whitelisted permitted holder** of vRWA inventory, **traders are
KYC-checked in `beforeSwap` on receipt only**. Reg D tier only; Reg A+ runs fully open. One open
blocker: whether the LP side needs a 3(c)(7) qualified-purchaser gate under the Investment Company Act
(per the Ondo OUSG precedent) — flagged for counsel, not resolved.
