#!/usr/bin/env python3
"""LP Gateway V1 -- round-3 economic models (audit scope s8 Q1-Q5 + invariant 15).

Closed-form / numeric companions to contracts-v4/test/audit3/Econ*.t.sol. Every number the fork
simulations assert against is produced here, from the SAME primitives the contract uses:

  * Uniswap v3/v4 concentrated-liquidity swap math, fee on input, single in-range liquidity L
  * position value V(P) = L*(2*sqrtP - sqrtPa - P/sqrtPb) for Pa <= P <= Pb (ticks +-22980)
  * clamped follower: one step of <= band (bps of sqrtPrice) per block.number toward spot
  * deposit mark = idle + max(V(spot), V(ref)); shares = D * S / NAV_mark (VIRTUAL offset ignored)
  * pure pro-rata exit; re-credit = shares * (claim - delivered) / claim, claim marked at cached spot
  * deploy cap: deployedPrincipal + q <= 0.5 * (staged + deployedPrincipal); band |spot - ref| <= band

Conventions: quote (USDG) = currency1, so P = quote per paired, sqrtP0 = 1 at the reference state;
"R" = the pool's in-range virtual quote reserve = L*sqrtP0 = L. All quote amounts in USDG.

Run:  python3 scripts/audit3/econ_models.py            (prints every table in the report)
      python3 scripts/audit3/econ_models.py --json     (machine-readable)
"""
from __future__ import annotations

import json
import math
import sys

# ── constants (contract) ─────────────────────────────────────────────────────────────────────
TL, TU = -22980, 22980
SQRT_PA = 1.0001 ** (TL / 2)  # 0.31685
SQRT_PB = 1.0001 ** (TU / 2)  # 3.15604
PA, PB = SQRT_PA**2, SQRT_PB**2
BAND_BPS = 500  # maxDeviationBps (factory default)
PHI = 0.003  # 0.30 % fee tier
CAP = 0.5  # MAX_DEPLOY_BPS
VIRTUAL = 1e6  # ignored in the closed forms (dust)


# ── position value / liquidity ───────────────────────────────────────────────────────────────
def v_of_L(L: float, P: float) -> float:
    """Quote value of liquidity L at price P, both legs marked at P (mirrors _deployedQuoteValueAt)."""
    s = math.sqrt(P)
    if s <= SQRT_PA:
        return L * (1 / SQRT_PA - 1 / SQRT_PB) * P  # all paired
    if s >= SQRT_PB:
        return L * (SQRT_PB - SQRT_PA)  # all quote
    return L * (2 * s - SQRT_PA - P / SQRT_PB)


def legs_of_L(L: float, P: float) -> tuple[float, float]:
    """(quote leg, paired leg in paired units) of liquidity L at price P."""
    s = math.sqrt(P)
    s = min(max(s, SQRT_PA), SQRT_PB)
    return L * (s - SQRT_PA), L * (1 / s - 1 / SQRT_PB)


def L_for_balanced_quote(q: float, P: float = 1.0) -> float:
    """Liquidity minted by a balanced deploy that uses exactly q quote at price P (paired leg matched)."""
    return q / (math.sqrt(P) - SQRT_PA)


def markdown_frac(x: float) -> float:
    """g(x): fraction of V lost when price moves from 1 to 1/x (a dump by factor x)."""
    L = 1.0
    return 1 - v_of_L(L, 1 / x) / v_of_L(L, 1.0)


# ── swap math (fee on input) ─────────────────────────────────────────────────────────────────
def buy_paired(L: float, sqrt0: float, sqrt1: float, phi: float = PHI) -> tuple[float, float]:
    """Push sqrtP from sqrt0 up to sqrt1 with quote (currency1). Returns (quote_in gross, paired_out)."""
    quote_in = L * (sqrt1 - sqrt0) / (1 - phi)
    paired_out = L * (1 / sqrt0 - 1 / sqrt1)
    return quote_in, paired_out


def sell_paired(L: float, sqrt0: float, sqrt1: float, phi: float = PHI) -> tuple[float, float]:
    """Push sqrtP from sqrt0 DOWN to sqrt1 with paired (currency0). Returns (paired_in gross, quote_out)."""
    paired_in = L * (1 / sqrt1 - 1 / sqrt0) / (1 - phi)
    quote_out = L * (sqrt0 - sqrt1)
    return paired_in, quote_out


def sell_paired_exact_in(L: float, sqrt0: float, paired_in: float, phi: float = PHI) -> tuple[float, float]:
    eff = paired_in * (1 - phi)
    inv1 = 1 / sqrt0 + eff / L
    sqrt1 = 1 / inv1
    return sqrt1, L * (sqrt0 - sqrt1)


def buy_paired_exact_in(L: float, sqrt0: float, quote_in: float, phi: float = PHI) -> tuple[float, float]:
    eff = quote_in * (1 - phi)
    sqrt1 = sqrt0 + eff / L
    return sqrt1, L * (1 / sqrt0 - 1 / sqrt1)


def round_trip_cost(R: float, x: float, dump: bool, phi: float = PHI) -> dict:
    """Move price by factor x (pump if not dump, dump to 1/x if dump) on virtual reserve R (=L at sqrtP0=1)
    and reverse immediately with the exact inventory received. Returns the attacker's costs.
    no_arb  : fees + residual slippage (the only cost when nobody trades against the displaced price)
    full_arb: the whole displacement is arbitraged away before the reversal -> attacker eats the entire
              one-leg slippage (inventory bought at the displaced price is worth its fair value only)."""
    L = R
    if not dump:
        s1 = math.sqrt(x)
        qin, pout = buy_paired(L, 1.0, s1, phi)
        s_end, qout = sell_paired_exact_in(L, s1, pout, phi)
        no_arb = qin - qout
        full_arb = qin - pout * 1.0
        capital = qin
    else:
        s1 = 1 / math.sqrt(x)
        pin, qout = sell_paired(L, 1.0, s1, phi)
        s_end, pback = buy_paired_exact_in(L, s1, qout, phi)
        # residual: paired not recovered, valued at fair 1.0
        no_arb = (pin - pback) * 1.0
        full_arb = pin * 1.0 - qout
        capital = pin  # paired inventory at fair value
    return {"x": x, "no_arb": no_arb, "full_arb": full_arb, "capital": capital, "fees_only": phi * capital + phi * (qout if dump else pout) }


def blocks_to_walk(x: float, band_bps: int = BAND_BPS, up: bool = True) -> int:
    """Blocks for the follower to move sqrtP by factor sqrt(x) at <= band per block."""
    b = band_bps / 10_000
    target = math.sqrt(x)
    n, r = 0, 1.0
    while (r < target - 1e-12) if up else (r > 1 / target + 1e-12):
        r = r * (1 + b) if up else r * (1 - b)
        n += 1
        if n > 10_000:
            break
    return n


# ── Q1/Q3: entry-mark cheapening (attacker deposits at a dumped mark) ───────────────────────────
def entry_cheapening(R: float, s: float, x: float, D_mult: float, phi: float = PHI, cap: float = CAP,
                     arb: float = 0.0, blocks: int = 1) -> dict:
    """Gateway: quote leg q = s*R deployed balanced at P=1, idle = q*(1-cap)/cap (cap=0.5 -> idle=q),
    LP value V = 2q (owner paired leg counted as depositor NAV). NAV = idle + V.
    Attacker dumps by factor x, snaps/walks the follower so mark = V(1/x), deposits D = D_mult*NAV,
    reverses the dump, exits pro-rata next block at fair.
      gain = D * dV / (NAV - dV + D),  dV = V*g(x)
      cost = round-trip fees/slippage (+ arb inventory loss per held block)."""
    q = s * R
    idle = q * (1 - cap) / cap
    V = 2 * q
    NAV = idle + V
    g = markdown_frac(x)
    dV = V * g
    D = D_mult * NAV
    gain = D * dV / (NAV - dV + D)
    rt = round_trip_cost(R, x, dump=True, phi=phi)
    cost = rt["no_arb"] + arb * rt["full_arb"] * max(blocks, 1)
    return {"R": R, "s": s, "x": x, "g": g, "NAV": NAV, "V": V, "dV_max_gain": dV, "D": D, "gain": gain,
            "cost_no_arb": rt["no_arb"], "cost_full_arb_per_block": rt["full_arb"], "cost": cost,
            "ratio": gain / cost if cost > 0 else float("inf"), "capital": D + rt["capital"],
            "blocks": blocks, "loss_pct_of_NAV": 100 * gain / NAV}


def breakeven_share(x: float, D_mult: float, phi: float = PHI, cap: float = CAP) -> float:
    """Smallest gateway share s at which entry cheapening by factor x breaks even (no arb)."""
    lo, hi = 1e-6, 0.5
    for _ in range(80):
        mid = (lo + hi) / 2
        if entry_cheapening(1.0, mid, x, D_mult, phi, cap)["ratio"] >= 1:
            hi = mid
        else:
            lo = mid
    return hi


# ── Q1/Q3: in-band deploy sandwich ───────────────────────────────────────────────────────────────
def deploy_sandwich(R: float, q_deploy: float, d: float, phi: float = PHI) -> dict:
    """Attacker pushes sqrtP up by fraction d (<= band, or 2 steps with a same-block poke), owner deploys
    q_deploy quote (balanced) at the pushed price, attacker reverses on the deeper pool.
    Exact numeric: leg 1 on L=R, leg 2 on L + dL."""
    L = R
    s1 = 1 + d
    qin, pout = buy_paired(L, 1.0, s1, phi)
    dL = q_deploy / (s1 - SQRT_PA)  # liquidity the gateway adds at the pushed price
    s_end, qout = sell_paired_exact_in(L + dL, s1, pout, phi)
    pnl = qout - qin
    # depositor loss: position minted at s1, marked at the post-reversal price s_end
    minted_value_at_fair = v_of_L(dL, s_end**2)
    contributed = q_deploy + legs_of_L(dL, s1**2)[1] * s_end**2  # quote + owner paired valued at fair
    return {"R": R, "q_deploy": q_deploy, "d": d, "dL_over_L": dL / L, "attacker_pnl": pnl,
            "gross_gain_approx": dL * d * d * (L / (L + dL)) / (1 + d) ** 2, "fees": phi * (qin + pout * s_end**2),
            "depositor_loss": contributed - minted_value_at_fair, "breakeven_dL_over_L": 2 * phi / d}


# ── Q2: IL exposure vs cap ───────────────────────────────────────────────────────────────────────
def il_table(cap: float = CAP, principal: float = 100.0) -> list[dict]:
    """Depositor NAV (as % of principal) vs price, for a balanced deploy at P=1 with cap c:
    q = c*principal deployed, idle = principal - q, V(P) = value of L(q) incl. the owner's paired leg."""
    q = cap * principal
    idle = principal - q
    L = L_for_balanced_quote(q)
    rows = []
    for P in (0.0, PA, 0.2, 0.3, 0.5, 0.8, 1.0, 1.25, 2.0, 4.0, PB, 20.0):
        V = v_of_L(L, P)
        nav = idle + V
        ql, pl = legs_of_L(L, P)
        rows.append({"P": P, "V": V, "nav_pct_principal": 100 * nav / principal,
                     "nav_pct_of_deploy_nav": 100 * nav / (principal + q),
                     "paired_leg_over_quote_leg": "all paired" if ql < 1e-9 * q else ("all quote" if pl < 1e-12 else (pl * P) / ql)})
    return rows


# ── Q1: per-block vs per-time follower on Arbitrum-Orbit cadence ──────────────────────────────────
def follower_cadence_table() -> list[dict]:
    """Time to walk the reference 2x for candidate step sizes, given block.number = L1 block (~12 s) on
    Robinhood Chain, and what the same per-block rule would do on a chain whose block.number is the L2
    block (Arbitrum ~0.25 s, OP-stack 2 s) -- the portability argument for a per-second primitive."""
    rows = []
    for bps in (500, 200, 100, 50, 23):
        n = blocks_to_walk(2.0, bps, up=True)
        rows.append({"step_bps_sqrtP": bps, "price_step_pct_per_block": 100 * ((1 + bps / 1e4) ** 2 - 1),
                     "blocks_2x": n, "minutes_2x_L1_12s": n * 12 / 60, "seconds_2x_if_L2_blocks_0_25s": n * 0.25,
                     "seconds_2x_if_L2_blocks_2s": n * 2,
                     "max_1block_snap_markdown_pct": 100 * markdown_frac(1 / (1 - bps / 1e4) ** 2)})
    return rows


def principal_floor_price(cap: float) -> float:
    """Price below which depositor NAV < principal (owner leg no longer covers the quote-leg IL)."""
    q = cap
    L = L_for_balanced_quote(q)
    lo, hi = 1e-6, 1.0
    for _ in range(100):
        mid = (lo + hi) / 2
        if (1 - q) + v_of_L(L, mid) >= 1.0:
            hi = mid
        else:
            lo = mid
    return hi


# ── Q4: re-credit weight under adapter shortfall ─────────────────────────────────────────────────
def recredit_dump(R: float, s: float, f: float, x: float, shortfall_frac: float = 1.0, phi: float = PHI,
                  cap: float = CAP) -> dict:
    """Withdrawer holding fraction f of shares exits while the adapter serves (1-shortfall_frac) of the
    idle leg. She dumps by x first (same block, atomic). claim = f*idle + f*V(1/x); undelivered idle
    X = shortfall*f*idle -> reCredit = shares*X/claim. Fair reCredit uses V(1). Excess shares are worth
    excess*NAV/S at fair once the price is restored (co-depositors pay)."""
    q = s * R
    idle = q * (1 - cap) / cap
    V = 2 * q
    NAV = idle + V
    X = shortfall_frac * f * idle
    claim_fair = f * idle + f * V
    claim_low = f * idle + f * V * (1 - markdown_frac(x))
    rc_fair = X / claim_fair  # as fraction of her shares
    rc_low = X / claim_low
    # value of a share fraction of her stake = f*NAV (pre-exit) -> excess value
    excess_value = (rc_low - rc_fair) * f * NAV
    rt = round_trip_cost(R, x, dump=True, phi=phi)
    return {"R": R, "s": s, "f": f, "x": x, "X_undelivered": X, "recredit_frac_fair": rc_fair,
            "recredit_frac_manip": rc_low, "excess_recredit_pct": 100 * (rc_low / rc_fair - 1),
            "gain": excess_value, "cost_no_arb": rt["no_arb"], "ratio": excess_value / rt["no_arb"],
            "gain_pct_of_NAV": 100 * excess_value / NAV}


# ── Invariant 15: compromised owner, single-sided quote deploy above the range ───────────────────
def owner_above_range(R: float, s_new: float, phi: float = PHI, hold_blocks: int | None = None) -> dict:
    """Owner pumps to Pb (all-quote range), walks the follower there, deploys q = s_new*R of depositor
    quote with NO paired leg, then dumps its inventory back to P=1 through the (now deeper) pool.
    Gateway position ends at fair with value v_of_L(q/(sqrtPb - sqrtPa), 1)."""
    q = s_new * R
    L = R
    x = PB
    n = blocks_to_walk(x, BAND_BPS, up=True) if hold_blocks is None else hold_blocks
    qin, pout = buy_paired(L, 1.0, SQRT_PB, phi)
    Lg = q / (SQRT_PB - SQRT_PA)
    # reverse on L + Lg from sqrtPb down; the attacker sells all paired bought
    s_end, qout = sell_paired_exact_in(L + Lg, SQRT_PB, pout, phi)
    pos_value_fair = v_of_L(Lg, s_end**2)
    depositor_loss = q - pos_value_fair
    attacker_net = qout - qin  # quote only; paired fully unwound
    return {"R": R, "q": q, "blocks_to_walk": n, "pump_capital": qin, "fees_approx": phi * qin + phi * pout * 1.0,
            "position_value_at_fair": pos_value_fair, "depositor_loss": depositor_loss,
            "loss_pct_of_q": 100 * depositor_loss / q, "attacker_net_no_arb": attacker_net,
            "breakeven_note": "profit iff 0.519*q > fees ~ 0.85%*R  ->  s_new > ~1.6%"}


def owner_worst_case_table() -> list[dict]:
    rows = []
    for name, R in (("reference PONS/USDG", 14.0e6), ("harness", 2.2e6 + 146_000), ("policy minimum", 250_000.0)):
        for s in (0.02, 0.05):
            o = owner_above_range(R, s)
            # principal = 2q (cap full after this deploy) ; NAV before = principal (nothing deployed before)
            rows.append({"pool": name, "R": R, "share_at_deploy": s, "q": o["q"], "blocks": o["blocks_to_walk"],
                         "pump_capital": o["pump_capital"], "depositor_loss": o["depositor_loss"],
                         "loss_pct_principal": 100 * o["depositor_loss"] / (2 * o["q"]),
                         "loss_pct_nav": 100 * o["depositor_loss"] / (2 * o["q"]),
                         "attacker_net_no_arb": o["attacker_net_no_arb"]})
    return rows


# ── Q5: subsidy flow ─────────────────────────────────────────────────────────────────────────────
def subsidy_sequence() -> list[dict]:
    """Alice 100 deposits; owner deploys 50 quote + 50 paired (gift); Bob deposits 100 at NAV 150; price
    halves; both exit. Who captured the owner's 50?"""
    S, nav = 100.0, 100.0  # alice shares / NAV
    rows = [{"step": "alice deposits 100", "alice_claim": 100.0, "bob_claim": 0.0, "nav": 100.0}]
    L = L_for_balanced_quote(50.0)
    nav = 50 + v_of_L(L, 1.0)  # idle 50 + LP 100
    rows.append({"step": "owner deploys 50q + 50p (gift)", "alice_claim": nav, "bob_claim": 0.0, "nav": nav})
    sB = 100 * S / nav
    S2 = S + sB
    nav2 = nav + 100
    rows.append({"step": "bob deposits 100 at NAV 150", "alice_claim": S / S2 * nav2, "bob_claim": sB / S2 * nav2, "nav": nav2})
    nav3 = 150 + v_of_L(L, 0.5)
    rows.append({"step": "price halves (LP 100 -> %.1f)" % v_of_L(L, 0.5), "alice_claim": S / S2 * nav3, "bob_claim": sB / S2 * nav3, "nav": nav3})
    nav4 = 150 + v_of_L(L, 2.0)
    rows.append({"step": "instead: price doubles (LP 100 -> %.1f)" % v_of_L(L, 2.0), "alice_claim": S / S2 * nav4, "bob_claim": sB / S2 * nav4, "nav": nav4})
    return rows


# ── report ───────────────────────────────────────────────────────────────────────────────────────
def fmt(v):
    if isinstance(v, float):
        if abs(v) >= 1000:
            return f"{v:,.0f}"
        return f"{v:.4g}"
    return str(v)


def table(rows: list[dict], cols: list[str]):
    print("| " + " | ".join(cols) + " |")
    print("|" + "---|" * len(cols))
    for r in rows:
        print("| " + " | ".join(fmt(r.get(c, "")) for c in cols) + " |")
    print()


def main():
    out = {}
    print("## Follower walk: blocks and cost to move the reference 2x (band 500 bps sqrtP/block)\n")
    walk = []
    for name, R in (("reference PONS/USDG (R=14.0M)", 14.0e6), ("harness (R=2.35M)", 2.2e6 + 146_000),
                    ("policy minimum (R=250k)", 250_000.0)):
        for dump in (False, True):
            rt = round_trip_cost(R, 2.0, dump)
            n = blocks_to_walk(2.0, BAND_BPS, up=not dump)
            walk.append({"pool": name, "dir": "dump" if dump else "pump", "blocks": n, "seconds_L1": n * 12,
                         "capital": rt["capital"], "cost_no_arb": rt["no_arb"],
                         "cost_full_arb_per_block": rt["full_arb"], "cost_no_arb_pct_R": 100 * rt["no_arb"] / R})
    table(walk, ["pool", "dir", "blocks", "seconds_L1", "capital", "cost_no_arb", "cost_full_arb_per_block", "cost_no_arb_pct_R"])
    out["walk"] = walk
    print("### follower cadence: per-block step vs chain block semantics\n")
    cad = follower_cadence_table()
    table(cad, ["step_bps_sqrtP", "price_step_pct_per_block", "blocks_2x", "minutes_2x_L1_12s", "seconds_2x_if_L2_blocks_0_25s", "seconds_2x_if_L2_blocks_2s", "max_1block_snap_markdown_pct"])
    out["cadence"] = cad

    print("## Entry-mark cheapening (attacker as depositor). g(x) = LP mark-down for a dump by x\n")
    gx = [{"x": x, "sqrt_step_pct": 100 * (1 - 1 / math.sqrt(x)), "g": markdown_frac(x), "g_over_d": markdown_frac(x) / (math.sqrt(x) - 1), "blocks_to_walk": blocks_to_walk(x, BAND_BPS, up=False)} for x in (1.05, 1.1, 1.1080, 1.2, 1.5, 2.0, 4.0, 1 / PA)]
    table(gx, ["x", "sqrt_step_pct", "g", "g_over_d", "blocks_to_walk"])
    out["g"] = gx

    ec = []
    for name, R in (("reference", 14.0e6), ("harness", 2.2e6 + 146_000), ("policy-min", 250_000.0)):
        for s in (0.02, 0.043, 0.05):
            for x, D_mult, blocks in ((1.108, 1.0, 1), (2.0, 1.0, 7), (2.0, 3.0, 7), (1 / PA, 3.0, 23)):
                e = entry_cheapening(R, s, x, D_mult, blocks=blocks)
                e["pool"] = name
                ec.append(e)
    table(ec, ["pool", "s", "x", "blocks", "NAV", "D", "gain", "cost_no_arb", "ratio", "capital", "loss_pct_of_NAV", "cost_full_arb_per_block"])
    out["entry_cheapening"] = ec
    be = [{"x": x, "D_mult": m, "breakeven_share_pct": 100 * breakeven_share(x, m)} for x in (1.108, 2.0, 1 / PA) for m in (1.0, 3.0, 100.0)]
    print("### break-even gateway share (no arb): ratio = 1\n")
    table(be, ["x", "D_mult", "breakeven_share_pct"])
    out["breakeven"] = be

    print("## In-band deploy sandwich\n")
    ds = []
    for name, R in (("reference", 14.0e6), ("harness", 2.2e6 + 146_000), ("policy-min", 250_000.0)):
        for s in (0.02, 0.05, 0.10):
            for d in (0.05, 0.1025):
                r = deploy_sandwich(R, s * R, d)
                r["pool"], r["share"], r["steps"] = name, s, 1 if d < 0.06 else 2
                ds.append(r)
    table(ds, ["pool", "share", "steps", "d", "dL_over_L", "attacker_pnl", "fees", "depositor_loss", "breakeven_dL_over_L"])
    out["deploy_sandwich"] = ds

    print("## Q2: depositor NAV vs price for a balanced deploy at the cap (c = 0.5); range +-22980 ticks\n")
    il = il_table()
    table(il, ["P", "V", "nav_pct_principal", "nav_pct_of_deploy_nav", "paired_leg_over_quote_leg"])
    out["il"] = il
    pf = [{"cap": c, "principal_floor_price": principal_floor_price(c), "max_loss_pct_principal": 100 * c, "max_loss_pct_nav_at_deploy": 100 * 2 * c / (1 + c)} for c in (0.2, 0.3, 0.4, 0.5)]
    table(pf, ["cap", "principal_floor_price", "max_loss_pct_principal", "max_loss_pct_nav_at_deploy"])
    out["principal_floor"] = pf

    print("## Q4: re-credit weight dump under adapter shortfall\n")
    rc = []
    for name, R in (("reference", 14.0e6), ("harness", 2.2e6 + 146_000), ("policy-min", 250_000.0)):
        for s in (0.02, 0.05):
            for f in (0.5, 0.9):
                for x in (1.108, 4.0):
                    r = recredit_dump(R, s, f, x)
                    r["pool"] = name
                    rc.append(r)
    table(rc, ["pool", "s", "f", "x", "X_undelivered", "excess_recredit_pct", "gain", "cost_no_arb", "ratio", "gain_pct_of_NAV"])
    out["recredit"] = rc

    print("## Invariant 15: compromised owner, all-quote deploy above the range\n")
    ow = owner_worst_case_table()
    table(ow, ["pool", "share_at_deploy", "q", "blocks", "pump_capital", "depositor_loss", "loss_pct_principal", "attacker_net_no_arb"])
    out["owner"] = ow

    print("## Q5: subsidy flow\n")
    sub = subsidy_sequence()
    table(sub, ["step", "alice_claim", "bob_claim", "nav"])
    out["subsidy"] = sub

    if "--json" in sys.argv:
        json.dump(out, sys.stdout, indent=1, default=str)


if __name__ == "__main__":
    main()
