# RWA Deals — Lifecycle & Trust Model

> **Status:** The full deal pipeline — register → verify → author → approve → publish → redeem →
> settle — is **live in production** and runs off-chain (no new contracts required). On-chain
> deposits and settlement use the RWA contract family, which is on testnet and gated on the legal
> track before mainnet.

The RWA surface lets a vetted **asset provider (issuer)** bring a real-world asset on-chain — private
credit, real-estate notes, energy off-take — and present it as a full, diligence-ready **deal page**.
It borrows the information architecture proven by the leading tokenized-RWA platforms (Centrifuge for
the pool/issuer/data-room model, Ondo for NAV clarity, Maple for redemption UX) and maps it onto
Mintware's on-chain trust primitives.

---

## The lifecycle

```
1. Register        issuer submits their profile        → status REGISTERED
        ↓
2. Verify          Mintware diligence-checks + approves → status VERIFIED
        ↓
3. Author          issuer builds the deal page          → deal in_review
        ↓
4. Approve         Mintware reviews deal + documents     → deal approved
        ↓
5. Publish         deal goes live at /vault/[id]         → visible to allocators
        ↓
6. Request Redeem  holder requests redemption           → redemption pending
        ↓
7. Settle          issuer settles after KYC (30-day)     → redemption settled
```

Only **VERIFIED** issuers can publish, and only **approved** deals are ever shown publicly. Every step
is gated — this is a curated surface, not a permissionless free-for-all, because RWA carries real
legal and counterparty risk.

---

## For issuers

### 1 · Register
Any wallet can register an asset-provider profile at **`/issuer/register`** — name, links, and a
signed message proving wallet ownership (no gas). This creates a `REGISTERED` issuer that enters the
Mintware review queue. Registered issuers **cannot** publish yet.

### 2 · Get verified
Mintware reviews the issuer against the SPV asset-provider registry (diligence pack, legal opinion,
track record) and promotes them to `VERIFIED`. Verification is the gate that unlocks deal publishing.

### 3 · Author a deal
A VERIFIED issuer creates a deal through the surface-aware create flow at **`/vault/create` → RWA**, a
guided wizard:

| Step | What you provide |
|---|---|
| Issuer | Select your verified issuer profile |
| Instrument | `vRWA` name, asset class, reserve/yield split, oracle bands, KYC tier |
| Deal | Overview, **where the yield comes from**, **price / NAV explanation**, target APY, min investment |
| Data room | External links + documents (term sheet, legal opinion, SPV structure, audit) |
| Review | Sign + submit → enters Mintware review |

### 4 · Approval & publish
Mintware reviews the deal narrative, terms, and each document. On approval, the deal — and its
data-room documents — go live, and the deal page renders at `/vault/[id]` with the full overview, key
terms, yield/NAV explainers, and reviewed data room.

---

## The review gate — why it's curated

RWA carries liability that permissionless DeFi does not, so trust is enforced at **two layers**:

- **Content layer** — issuers must be VERIFIED, and deal content (especially documents and price
  claims) passes Mintware review (`draft → in_review → approved`) before anything is public.
- **Code layer** — the on-chain guardian / kill-switch, oracle price bands, and reserve invariants
  back the content review with contract-enforced limits.

This mirrors how billion-dollar RWA platforms operate: a known originator, a reviewed deal, and
on-chain enforcement — not anonymous listings.

---

## Trust, enforced on-chain

The rules that protect an allocator's position live in code, are verifiable, and can't be quietly
changed:

| Guarantee | How it's enforced |
|---|---|
| **Non-custodial** | You self-custody `vRWA`. No one, including the team, can move your principal. |
| **Oracle-banded price** | Swaps are constrained to **±15% (core) / ±45% (spec)** around the published NAV; trades outside the spec band revert. |
| **Reserve-backed** | A **40 / 60** reserve/yield split with a reserve-ratio invariant backs redemptions. |
| **KYC at the trade boundary (Reg D)** | Reg D `vRWA` transfers are whitelist-gated (`SPVBeneficiaryRegistry`, tiered: Basic / Accredited / Institutional); redemption re-checks KYC. Reg A+ deals trade openly. |
| **Guardian / kill-switch** | Transfer modes (permissionless / whitelisted / frozen) and a guardian freeze protect the instrument, behind a 48-hour timelock. |

---

## Redemption — the async 30-day flow

`vRWA` is a claim on a real-world asset, so redemption is a request, not an instant swap:

```
Request Redeem  →  30-day settlement window  →  issuer confirms settlement (KYC-gated)
   pending                                              settled
```

- A holder requests redemption of a stated value from any published RWA deal page (a signed request,
  no gas).
- The request enters a **30-day window** — the notice period the underlying asset needs to unwind.
- After the window, the issuer settles the request following a KYC check. Holders track their requests
  through `pending → ready → settled` on the **`/redemptions`** page; Mintware operators advance and
  settle them from the review queue.

---

## What's live vs pending

| | Status |
|---|---|
| Issuer registration + verification | **Live** |
| Deal authoring (surface-split create wizard) | **Live** |
| Mintware review + approve/reject (deals, issuers, documents) | **Live** |
| Published deal page (`/vault/[id]`) | **Live** |
| Redemption request + admin settle (off-chain intent ledger) | **Live** |
| RWA contracts (vRWA, oracle bands, SPV/KYC registries, escrow, async redeem) | Built, **testnet** |
| On-chain deposits + settlement on mainnet | **Pending** — gated on the legal track |

The app-level deal pipeline is complete and operable today; the on-chain settlement layer activates
when the RWA contracts clear legal and deploy to mainnet.

---

*Engineering detail — contracts, schema, routes, admin auth — is in the
[Vaults & RWA Build Spec](../developers/vaults-rwa-build-spec.md).*
