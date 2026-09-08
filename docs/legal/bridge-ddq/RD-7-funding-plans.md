# RD-7 — Funding Plans (Run on the Asset / Run on the Business)

**Status: answerable now from real, existing engineering — cited against the live code, not aspirational.**

## Run on the asset (rapid value decline in a crypto asset or asset pair)

Mintware's program is USDC-denominated — the single most liquid, centrally-issued dollar stablecoin,
not an exotic or volatile asset pair. Where ETH/LST collateral is involved elsewhere in the platform, it
is discounted by a fixed VaR-style haircut before being counted as spendable, so a price move doesn't
translate 1:1 into spending power.

The structural protection against a value-decline event is the **senior/junior tranche ordering**, which
is code-enforced, not discretionary:

- Community-facing capital is the **senior**, par-protected, spendable claim.
- The team's own capital is the **junior**, first-loss tranche — contractually required to absorb any
  shortfall (impermanent loss, price decline) *before* senior capital is ever touched.
- Senior redemption itself draws from a waterfall in a fixed order: free senior buffer, then a yield
  adapter (Aave), then — only if still short — a bounded, partial recovery from the deployed liquidity
  position, with the junior tranche as the last-resort backstop. This ordering cannot be altered by any
  admin call.

## Run on the business (rapid, correlated withdrawal/spend demand)

Two independent, code-enforced circuit breakers exist specifically for this scenario:

1. **System-wide circuit breaker.** A global halt flag can stop *all* new authorizations platform-wide,
   regardless of any individual member's balance or cap — a deliberate stop-loss if a stress condition
   (e.g. the junior cushion or overall coverage ratio falling below a floor) is detected.
2. **Always-liquid hot-buffer reserve.** A configurable minimum-liquidity floor is enforced *before* any
   charge is allowed to draw usable liquidity below it — sized to absorb settlement-timing risk (weekend/
   holiday gaps between authorization and settlement, plus settlement slippage), so a spike in demand
   cannot silently push the system below what it needs to stay whole.

Both mechanisms fail toward halting activity rather than continuing to approve against a system that may
not be able to honor its obligations.

## Access to external capital — stated honestly, not overstated

**Mintware does not currently have a committed external credit facility, backstop line, or third-party
capital-injection arrangement for stressed scenarios.** The protection model today is architectural, not
capital-based: first-loss absorption by the team's own junior tranche, plus the circuit breaker and
reserve floor described above, which halt the system before it can be pushed into insolvency rather than
relying on an external party to recapitalize it after the fact.

This is an accurate reflection of an early-stage program and should be presented as such — the honest
gap is the absence of external capital access, not the absence of any risk controls at all.
