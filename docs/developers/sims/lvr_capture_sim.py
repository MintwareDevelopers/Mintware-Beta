#!/usr/bin/env python3
"""
LVR-capture sim for Mintware YPN thin community pools.

Question: "On a low cap I trade with 4-7% slippage. Can we capture that?"

Model: constant-product (x*y=k) pool = the mechanic that GENERATES slippage.
We decompose a trader's slippage into:
  - PERMANENT impact  -> the market genuinely repriced. Nobody captures it.
  - TEMPORARY impact (LVR) -> reverts. Currently an MEV/arb bot captures it.
                              A hook can capture it -> Mintware treasury.

We report, for a realistic pool + trade:
  S      = trader's slippage in $ (what they lose vs mid)
  C_lvr  = $ our hook captures by recapturing the reverting dislocation
           (the arb a bot does today), for several "temporary fractions" beta
  C_fee  = $ a dynamic/surge fee captures instead (single-venue fallback)
  ratios = C / S  ("of your slippage, we capture Y%")

All honest: LVR capture is bounded by the TEMPORARY fraction (an assumption we
sweep, because it is unknowable per-token) and reduced by the fee the arb pays.
"""

FEE = 0.003  # 0.3% standard pool fee, paid on every trade (incl. the recapture arb)

def buy(Ru, Rt, dU, fee=FEE):
    """Trader spends dU USDC to buy token. Uniswap-v2 mechanics (fee stays in pool)."""
    k = Ru * Rt
    Ru1 = Ru + dU                       # full input enters the reserve
    Rt1 = k / (Ru + dU * (1 - fee))     # output uses (1-fee) -> k grows by the fee
    tokens_out = Rt - Rt1
    Rt1 = Rt - tokens_out
    return Ru1, Rt1, tokens_out

def spot(Ru, Rt):
    return Ru / Rt  # USDC per token

def solve_trade_for_slippage(Ru, Rt, target_slip):
    """Find dU (USDC buy) that yields ~target_slip realized slippage vs mid."""
    p0 = spot(Ru, Rt)
    lo, hi = 1.0, Ru * 4
    for _ in range(80):
        dU = (lo + hi) / 2
        _, _, tok = buy(Ru, Rt, dU)
        exec_price = dU / tok
        slip = exec_price / p0 - 1
        if slip > target_slip:
            hi = dU
        else:
            lo = dU
    return (lo + hi) / 2

def recapture_lvr(Ru1, Rt1, p_true):
    """
    Pool sits mispriced at P1 = Ru1/Rt1 after the buy. Our hook sells token into
    the pool until spot == p_true, sourcing token externally at p_true (multi-venue).
    Returns the hook's arb profit in USDC = the LVR it took back from the bots.
    Pays the pool FEE on the recapture trade (that fee accrues to LPs, not the hook).
    """
    k1 = Ru1 * Rt1
    # bisect token amount dT to sell so that final spot == p_true
    lo, hi = 0.0, Rt1 * 4
    for _ in range(100):
        dT = (lo + hi) / 2
        Rt2 = Rt1 + dT
        Ru2 = k1 / (Rt1 + dT * (1 - FEE))
        if Ru2 / Rt2 > p_true:
            lo = dT
        else:
            hi = dT
    dT = (lo + hi) / 2
    Rt2 = Rt1 + dT
    Ru2 = k1 / (Rt1 + dT * (1 - FEE))
    usdc_out = Ru1 - Ru2
    cost_to_source = dT * p_true          # buy dT tokens elsewhere at true price
    return usdc_out - cost_to_source      # hook profit (can be >0)

def analyze(tvl, target_slip, betas=(0.3, 0.5, 0.7), surge_fee=0.01):
    Ru = tvl / 2.0     # balanced pool, token priced at $1
    Rt = Ru
    p0 = spot(Ru, Rt)

    dU = solve_trade_for_slippage(Ru, Rt, target_slip)
    Ru1, Rt1, tokens_out = buy(Ru, Rt, dU)
    exec_price = dU / tokens_out
    slip = exec_price / p0 - 1
    S = dU * slip                          # trader slippage in $ (approx cost vs mid)
    p1 = spot(Ru1, Rt1)

    rows = []
    for beta in betas:                     # beta = TEMPORARY (reverting) fraction
        p_true = p0 + (1 - beta) * (p1 - p0)
        C = recapture_lvr(Ru1, Rt1, p_true)
        rows.append((beta, C, C / S))
    C_fee = dU * surge_fee                 # dynamic/surge fee capture (single-venue)
    return dict(tvl=tvl, dU=dU, slip=slip, S=S, rows=rows, C_fee=C_fee,
                fee_ratio=C_fee / S, surge_fee=surge_fee)

def money(x):
    return f"${x:,.0f}" if abs(x) >= 100 else f"${x:,.2f}"

print("=" * 78)
print("LVR-CAPTURE SIM — thin community pools (constant product, 0.3% pool fee)")
print("beta = fraction of the price move that is TEMPORARY (reverts = capturable)")
print("=" * 78)

for tvl in (50_000, 200_000, 500_000, 1_000_000):
    print(f"\n### Pool TVL {money(tvl)}   (token = $1, balanced)")
    r = analyze(tvl, 0.05)   # target ~5% slippage
    print(f"  Trade to hit ~5% slippage: buy {money(r['dU'])} of token")
    print(f"  Realized slippage: {r['slip']*100:.2f}%   ->  trader loses ~{money(r['S'])} vs mid")
    print(f"  --- LVR RECAPTURE (hook takes the reverting dislocation from bots) ---")
    for beta, C, ratio in r['rows']:
        print(f"    beta={beta:.1f} (temp): capture {money(C):>9}  =  {ratio*100:5.1f}% of the trader's slippage")
    print(f"  --- DYNAMIC/SURGE FEE fallback (single-venue, {r['surge_fee']*100:.0f}% surge) ---")
    print(f"    capture {money(r['C_fee']):>9}  =  {r['fee_ratio']*100:5.1f}% of the trader's slippage (a fee, on top of their cost)")

print("\n" + "=" * 78)
print("SLIPPAGE-TARGET SWEEP @ $200k pool (how capture scales with how thin the trade is)")
print("=" * 78)
for tslip in (0.04, 0.05, 0.06, 0.07):
    r = analyze(200_000, tslip)
    beta5 = [row for row in r['rows'] if row[0] == 0.5][0]
    print(f"  {tslip*100:.0f}% slippage: trade {money(r['dU']):>8}, slip$ {money(r['S']):>7} | "
          f"LVR@beta0.5 {money(beta5[1]):>7} ({beta5[2]*100:4.1f}%) | fee(1%) {money(r['C_fee']):>7} ({r['fee_ratio']*100:4.1f}%)")

print("\nNOTES (honest):")
print(" - LVR capture is the arb a bot takes TODAY; 'capture' = redirect it to treasury.")
print(" - Bounded by beta (temporary fraction, unknowable per token -> we sweep it).")
print(" - Permanent fraction (1-beta) is NOT capturable by anyone -> real cost of thin liq.")
print(" - Single-venue new low-cap: no reference to arb -> fall back to the surge fee row.")
print(" - Naive JIT (our built hook) is dominated: it round-trips inventory through the SAME")
print("   thin pool, and the round-trip cost ~ the fee it earns -> ~break-even to negative.")
