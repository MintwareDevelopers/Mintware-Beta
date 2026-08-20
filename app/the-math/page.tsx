'use client'

// /the-math — the yield-engine simulator, on the platform (linked from the footer as "The Math").
// Shows WHERE the yield comes from: floor (curated lending) + fees + MEV, stacked; a live take-home
// comparison vs a traditional "2 and 20" fund; and the compression curve as TVL fills. Every lever is
// grounded in a real DeFi precedent. Honest throughout: it's a MODEL/simulation, not a promise (testnet,
// unaudited); crypto yield is taxable; no tax-invisibility framing. Light-only, platform design system.

import { useMemo, useState } from 'react'
import { MwNav } from '@/components/web2/MwNav'

const fmtUsd = (n: number) => {
  const a = Math.abs(n)
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M'
  if (a >= 1e3) return '$' + (n / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'K'
  return '$' + Math.round(n).toLocaleString()
}
const fmtFull = (n: number) => '$' + Math.round(n).toLocaleString()
const pct = (n: number) => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + '%'

type Pool = { floor: number; tvl: number; vol: number; fee: number; mev: number; lp: number; il: number }
const PRESETS: Record<string, Pool> = {
  cons: { floor: 5, tvl: 4_000_000, vol: 600_000, fee: 5, mev: 1, lp: 70, il: 0 },
  base: { floor: 5, tvl: 1_000_000, vol: 1_000_000, fee: 5, mev: 1.5, lp: 70, il: 0 },
  aggr: { floor: 6, tvl: 500_000, vol: 2_000_000, fee: 5, mev: 1.5, lp: 70, il: 0 },
}

function calc(p: Pool, tvl = p.tvl) {
  const feeApy = tvl > 0 ? (p.vol * (p.fee / 1e4) * 365 / tvl) * (p.lp / 100) * 100 : 0
  const mevApy = tvl > 0 ? (p.vol * (p.mev / 1e4) * 365 / tvl) * 100 : 0
  const net = Math.max(0, p.floor + feeApy + mevApy - p.il)
  return { floor: p.floor, feeApy, mevApy, ilApy: p.il, net }
}

const C = { floor: '#8A82F4', fees: '#6C6CF0', mev: '#2A9E8A', il: '#E88A67' }

const PRECEDENTS = [
  { tag: 'Fees · the engine', h: 'Concentrated-liquidity fee capture', p: 'LP fee yield = volume × fee ÷ liquidity. On efficient pools, active liquidity turns over many times a day, so stable and blue-chip pools have shown fee APYs from low single digits to well past 50% — purely as a function of the volume-to-liquidity ratio, no token emissions.', src: <>Precedent: <b>Uniswap&nbsp;v3</b> concentrated liquidity (2021). Mintware adds JIT provisioning to concentrate capital exactly on the swap.</> },
  { tag: 'MEV · returned to LPs', h: 'LVR recapture & am-AMM', p: 'Arbitrageurs extract measurable value from passive LPs every block (“loss-versus-rebalancing”). Peer-reviewed mechanisms auction the right to that flow back to the LPs instead of losing it to searchers — a return of value that already exists, not a new subsidy.', src: <>Precedent: <b>LVR</b> (Milionis–Moallemi–Roughgarden, 2022) · <b>am-AMM</b> research. Mintware’s hook implements am-AMM + a directional Diamond-LVR surcharge.</> },
  { tag: 'IL ≈ 0 · keepable fees', h: 'Stable pairs barely diverge', p: 'Most high-APY farms disappoint because impermanent loss quietly eats the fees. On pegged / correlated pairs (USDC-USDT, USDC-DAI) divergence loss is near zero — so the fees you earn are fees you keep. That’s the gap between a headline APY and a real one.', src: <>Precedent: <b>Curve StableSwap</b> — a whole category built on minimal-IL stable liquidity.</> },
  { tag: 'Floor · the safety layer', h: 'Curated lending rates', p: 'Idle capital doesn’t sit still — it earns the best available supply rate across audited lending venues. These rates are publicly observable and have run low-to-high single digits on USDC before any pool activity. A curator allocates across venues rather than betting on one.', src: <>Precedent: <b>Aave</b> · <b>Morpho</b> (optimizes on Aave/Compound) · <b>Euler</b>. Mintware fans idle capital across all three by weight.</> },
  { tag: 'The thing you’re beating', h: '“2 and 20,” locked', p: 'The traditional benchmark: ~2% of assets a year plus ~20% of the gains, with your capital locked for the term. A 12% headline can net ~7% after fees — and you can’t touch it. Mintware’s fee is a small cut on flow, and nothing is locked.', src: <>Precedent: the industry-standard <b>2-and-20</b> hedge-fund fee structure.</> },
  { tag: 'Liquidity · the real edge', h: 'Spendable while it earns', p: 'The unlock isn’t just yield — the balance stays usable. A spend is a hold against the earning position, settled by burning shares, so capital keeps earning right up to the moment it’s spent. Earn and spend, not earn or lock.', src: <>Mintware’s Yield Payment Network — cards / x402 / on-chain settlement against a live NAV.</> },
]

export default function TheMath() {
  const [preset, setPreset] = useState('base')
  const [dep, setDep] = useState(25_000)
  const [pool, setPool] = useState<Pool>(PRESETS.base)
  const [fund, setFund] = useState({ g: 12, m: 2, p: 20 })

  const setP = (k: keyof Pool, v: number) => setPool((p) => ({ ...p, [k]: v }))
  const pick = (key: string) => { setPreset(key); setPool(PRESETS[key]) }

  const r = useMemo(() => calc(pool), [pool])
  const activity = r.feeApy + r.mevApy
  const gt = r.floor + r.feeApy + r.mevApy || 1
  const mwTake = dep * r.net / 100
  const gg = dep * fund.g / 100
  const perf = gg > 0 ? gg * fund.p / 100 : 0
  const mgmt = dep * fund.m / 100
  const fundNet = gg - mgmt - perf
  const diff = mwTake - fundNet

  // compression curve
  const chart = useMemo(() => {
    const W = 620, H = 200, pad = { l: 38, r: 12, t: 14, b: 24 }, minT = 50_000, maxT = 20_000_000
    const pts = Array.from({ length: 61 }, (_, i) => { const t = minT * Math.pow(maxT / minT, i / 60); return { t, y: calc(pool, t).net } })
    const maxY = Math.max(20, Math.max(...pts.map((p) => p.y)) * 1.1)
    const X = (t: number) => pad.l + (Math.log(t / minT) / Math.log(maxT / minT)) * (W - pad.l - pad.r)
    const Y = (y: number) => pad.t + (1 - Math.min(y, maxY) / maxY) * (H - pad.t - pad.b)
    const line = pts.map((p, i) => (i ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.y).toFixed(1)).join(' ')
    const area = line + ` L ${X(maxT).toFixed(1)} ${H - pad.b} L ${pad.l} ${H - pad.b} Z`
    return { W, H, pad, maxY, X, Y, line, area, cx: X(pool.tvl), cy: Y(r.net) }
  }, [pool, r.net])

  const Slider = ({ v, min, max, step, on }: { v: number; min: number; max: number; step: number; on: (n: number) => void }) => (
    <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => on(+e.target.value)}
      className="mw-rng" style={{ ['--pct' as string]: ((v - min) / (max - min) * 100) + '%' }} />
  )

  return (
    <div className="min-h-screen bg-white font-atx-display text-ink">
      <MwNav />
      <main className="mx-auto max-w-[1100px] px-6 max-[700px]:px-4 py-[40px]">
        <div className="text-[11px] uppercase tracking-[0.16em] font-semibold text-peri-deep">
          The math · never idle · never locked · always yours
          <span className="ml-2 align-[2px] inline-block text-[10.5px] font-semibold tracking-[0.04em] text-[var(--color-coral2-deep)] border border-[color-mix(in_srgb,var(--color-coral2-deep)_40%,transparent)] rounded-full px-2 py-[2px]">simulation</span>
        </div>
        <h1 className="font-atx-display font-bold text-[clamp(1.9rem,4.7vw,3rem)] leading-[1.03] tracking-[-0.03em] mt-2.5">
          Where the yield actually<br /><span className="text-gradient-accent">comes&nbsp;from.</span>
        </h1>
        <p className="text-ink-mid text-[clamp(1rem,2vw,1.14rem)] leading-[1.5] max-w-[62ch] mt-3.5">
          Idle capital earns a floor doing nothing. When the network is busy, the pool captures swap fees + MEV on top.
          And it stays spendable the whole time. Drag the levers — watch the stack, and the take-home gap vs a locked fund.
        </p>

        <div className="mt-5 rounded-[14px] border border-hair p-[13px_16px] text-[13px] text-ink-mid leading-[1.5]"
          style={{ background: 'linear-gradient(120deg, rgba(244,161,131,.12), var(--color-ground-cool))' }}>
          <b className="text-ink">This is a model, not a promise.</b> Every number is a projection from the levers you set —
          real yield depends on real volume, which is still being built (testnet, unaudited). Illustrative, not investment
          advice. The point is the mechanism: how fees + MEV scale with activity, and why they compress as capital arrives.
        </div>

        {/* presets */}
        <div className="flex gap-2 mt-5 flex-wrap items-center">
          <span className="text-[11.5px] font-semibold tracking-[0.1em] uppercase text-ink-soft mr-1">Scenario</span>
          {([['cons', 'Conservative', 'quiet pool, deep TVL'], ['base', 'Base', 'busy stable pool'], ['aggr', 'Aggressive', 'lean pool, high flow']] as const).map(([k, t, s]) => (
            <button key={k} onClick={() => pick(k)}
              className={`glass-pill px-[15px] py-[9px] text-[13px] font-semibold cursor-pointer text-left ${preset === k ? 'text-white' : 'text-ink-mid'}`}
              style={preset === k ? { background: 'linear-gradient(135deg,var(--color-peri),var(--color-peri-deep))' } : {}}>
              {t}<span className="block font-medium text-[10.5px] opacity-80 mt-[1px]">{s}</span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-[330px_1fr] max-[880px]:grid-cols-1 gap-5 mt-[22px] items-start">
          {/* controls */}
          <div className="soft-card p-5">
            <Ctl label="Your deposit" val={fmtFull(dep)}><Slider v={dep} min={1000} max={1_000_000} step={1000} on={setDep} /></Ctl>
            <Ctl label="Floor rate" hint="Aave / Morpho / Euler" val={pct(pool.floor)}><Slider v={pool.floor} min={0} max={12} step={0.5} on={(n) => setP('floor', n)} /></Ctl>
            <Ctl label="Pool size (TVL)" val={fmtUsd(pool.tvl)} sub="more capital → thinner slice of the same fees"><Slider v={pool.tvl} min={50_000} max={20_000_000} step={50_000} on={(n) => setP('tvl', n)} /></Ctl>
            <Ctl label="Daily volume" val={fmtUsd(pool.vol) + '/day'} sub="the router points swaps at your own pools — the driver"><Slider v={pool.vol} min={0} max={20_000_000} step={100_000} on={(n) => setP('vol', n)} /></Ctl>
            <Ctl label="Fee tier" val={pool.fee + ' bps'}>
              <Seg opts={[[1, '1 bps'], [5, '5 bps'], [30, '30 bps'], [100, '100 bps']]} v={pool.fee} on={(n) => setP('fee', n)} />
            </Ctl>
            <Ctl label="Pair type" hint="drives impermanent loss">
              <Seg opts={[[0, 'Stable (IL ≈ 0)'], [3, 'Volatile']]} v={pool.il} on={(n) => setP('il', n)} gain />
            </Ctl>
            <Ctl label="MEV capture" hint="to LPs, bps of volume" val={pool.mev.toFixed(1) + ' bps'}><Slider v={pool.mev} min={0} max={8} step={0.5} on={(n) => setP('mev', n)} /></Ctl>
            <Ctl label="LP share of fees" hint="rest = protocol" val={pool.lp + '%'} last><Slider v={pool.lp} min={40} max={100} step={5} on={(n) => setP('lp', n)} /></Ctl>
          </div>

          {/* results */}
          <div>
            <div className="soft-card p-5">
              <div className="text-[11px] uppercase tracking-[0.16em] font-semibold text-ink-soft">Blended net APY on your deposit</div>
              <div className="flex items-end gap-5 flex-wrap">
                <div className="font-atx-display font-bold text-[clamp(3rem,8.5vw,4.8rem)] leading-[.9] tracking-[-0.04em] text-gradient-accent num">
                  {r.net.toFixed(r.net >= 100 ? 0 : 1)}<span className="text-[.32em] font-semibold text-ink-soft tracking-[-0.02em]">% APY</span>
                </div>
                <div className="text-[13px] text-ink-mid max-w-[32ch] pb-2">
                  {activity > r.floor
                    ? <>Floor is <b>{pct(r.floor)}</b>. Fees + MEV do the heavy lifting at <b className="text-peri-deep">{pct(activity)}</b>.</>
                    : <>Mostly the <b>{pct(r.floor)}</b> floor — crank <b>daily volume</b> to see the pool earn.</>}
                </div>
              </div>
              {/* stack bar */}
              <div className="mt-5">
                <div className="flex h-[44px] rounded-[11px] overflow-hidden border border-hair">
                  {([['Floor', C.floor, r.floor], ['Fees', C.fees, r.feeApy], ['MEV', C.mev, r.mevApy]] as const).map(([n, c, v]) => {
                    const w = (v as number) / gt * 100
                    return <div key={n} className="flex items-center justify-center text-[11.5px] font-semibold text-white overflow-hidden whitespace-nowrap transition-[width] duration-200" style={{ background: c, width: w + '%' }}>{w > 11 ? n : ''}</div>
                  })}
                  {r.ilApy > 0 && <div title="IL drag" style={{ width: Math.min(30, r.ilApy / gt * 100) + '%', background: `repeating-linear-gradient(45deg,${C.il},${C.il} 6px,transparent 6px,transparent 12px)` }} />}
                </div>
                <div className="flex flex-wrap gap-[14px] mt-3 text-[12px] text-ink-mid">
                  {([['Floor', C.floor, r.floor], ['Fees', C.fees, r.feeApy], ['MEV', C.mev, r.mevApy]] as const).map(([n, c, v]) => (
                    <span key={n}><i className="inline-block w-[10px] h-[10px] rounded-[3px] mr-1.5 align-[-1px]" style={{ background: c }} />{n} <span className="text-ink font-semibold num">{pct(v as number)}</span></span>
                  ))}
                  {r.ilApy > 0 && <span><i className="inline-block w-[10px] h-[10px] rounded-[3px] mr-1.5 align-[-1px]" style={{ background: C.il }} />− IL <span className="text-ink font-semibold num">{pct(r.ilApy)}</span></span>}
                </div>
              </div>
            </div>

            {/* comparison */}
            <div className="grid grid-cols-2 max-[520px]:grid-cols-1 gap-4 mt-5">
              <div className="rounded-[13px] p-4 border" style={{ borderColor: 'var(--color-peri-soft-2, rgba(108,108,240,.2))', background: 'linear-gradient(160deg, rgba(108,108,240,.10), var(--color-ground-cool))' }}>
                <h3 className="m-0 text-[13px] font-semibold text-ink-mid flex items-center gap-[7px]"><span className="w-2 h-2 rounded-full" style={{ background: 'var(--color-peri)' }} />Mintware — your take-home</h3>
                <div className="font-atx-display font-bold text-[2rem] tracking-[-0.03em] mt-2 mb-0.5 text-gradient-accent num">+{fmtFull(mwTake)}</div>
                <div className="text-[11.5px] text-ink-soft">{pct(r.net)} net · liquid &amp; spendable the whole time</div>
                <Wf rows={[
                  ['Floor + activity yield', '+' + pct(gt), 'pos'],
                  ...(r.ilApy > 0 ? [['Impermanent loss', '−' + pct(r.ilApy), 'neg'] as const] : []),
                  ['Lock-up / gates', 'none', 'pos'],
                  [`Net, on ${fmtUsd(dep)}`, '+' + fmtFull(mwTake), 'tot'],
                ]} />
              </div>
              <div className="rounded-[13px] p-4 border border-hair bg-ground-cool">
                <h3 className="m-0 text-[13px] font-semibold text-ink-mid flex items-center gap-[7px]"><span className="w-2 h-2 rounded-full" style={{ background: 'var(--color-coral2-deep)' }} />Traditional fund</h3>
                <div className="font-atx-display font-bold text-[2rem] tracking-[-0.03em] mt-2 mb-0.5 text-ink num">+{fmtFull(fundNet)}</div>
                <div className="text-[11.5px] text-ink-soft">locked · redemption gates · custodian holds it</div>
                <Wf rows={[
                  ['Gross return', '+' + pct(fund.g), 'pos'],
                  ['Management fee', '−' + fmtUsd(mgmt), 'neg'],
                  [`Performance fee (${fund.p}%)`, '−' + fmtUsd(perf), 'neg'],
                  [`Net, on ${fmtUsd(dep)}`, '+' + fmtFull(fundNet), 'tot'],
                ]} />
              </div>
            </div>

            <div className="mt-4 rounded-[12px] px-4 py-3.5 text-[13.5px] text-ink" style={{ background: 'rgba(17,163,126,.10)', border: '1px solid color-mix(in srgb,#11a37e 28%,transparent)' }}>
              {diff >= 0
                ? <>On {fmtUsd(dep)}, Mintware nets <b style={{ color: '#11a37e' }}>+{fmtFull(mwTake)}</b> vs the fund’s <b style={{ color: '#11a37e' }}>+{fmtFull(fundNet)}</b> — a <b style={{ color: '#11a37e' }}>{fmtFull(Math.abs(diff))}</b> edge, and yours stays liquid.</>
                : <>Here the fund’s headline wins on paper (<b style={{ color: '#11a37e' }}>+{fmtFull(fundNet)}</b> vs <b style={{ color: '#11a37e' }}>+{fmtFull(mwTake)}</b>) — but yours is liquid, self-custodied, and spendable in place. Push <b>daily volume</b> up and it flips.</>}
            </div>

            {/* curve */}
            <div className="soft-card p-5 mt-5">
              <div className="flex justify-between items-baseline mb-1.5"><span className="text-[13px] font-semibold">Yield compresses as the pool fills</span><span className="text-[11.5px] text-ink-soft">same volume · APY vs TVL</span></div>
              <svg viewBox={`0 0 ${chart.W} ${chart.H}`} preserveAspectRatio="none" className="block w-full h-auto">
                <defs><linearGradient id="mg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--color-peri)" stopOpacity=".28" /><stop offset="1" stopColor="var(--color-peri)" stopOpacity="0" /></linearGradient></defs>
                {[0, .25, .5, .75, 1].map((f) => { const y = chart.pad.t + f * (chart.H - chart.pad.t - chart.pad.b), v = chart.maxY * (1 - f); return <g key={f}><line x1={chart.pad.l} y1={y} x2={chart.W - chart.pad.r} y2={y} stroke="var(--color-hair-soft)" /><text x={chart.pad.l - 6} y={y + 3} textAnchor="end" fontSize="9" fill="var(--color-ink-soft)">{v.toFixed(0)}%</text></g> })}
                {[50_000, 500_000, 2_000_000, 20_000_000].map((t) => <text key={t} x={chart.X(t)} y={chart.H - 8} textAnchor="middle" fontSize="9" fill="var(--color-ink-soft)">{fmtUsd(t)}</text>)}
                <path d={chart.area} fill="url(#mg)" />
                <path d={chart.line} fill="none" stroke="var(--color-peri)" strokeWidth="2.5" strokeLinejoin="round" />
                <line x1={chart.cx} y1={chart.pad.t} x2={chart.cx} y2={chart.H - chart.pad.b} stroke="var(--color-peri-deep)" strokeWidth="1" strokeDasharray="3 3" opacity=".5" />
                <circle cx={chart.cx} cy={chart.cy} r="5" fill="#fff" stroke="var(--color-peri-deep)" strokeWidth="2.5" />
                <text x={Math.min(chart.cx + 8, chart.W - 70)} y={Math.max(chart.cy - 8, 14)} fontSize="11" fontWeight="600" fill="var(--color-peri-deep)" fontFamily="var(--font-space-grotesk)">you: {r.net.toFixed(r.net >= 100 ? 0 : 1)}%</text>
              </svg>
            </div>
          </div>
        </div>

        {/* precedents */}
        <h2 className="font-atx-display font-bold text-[clamp(1.4rem,3vw,1.8rem)] tracking-[-0.02em] mt-10 mb-1">The mechanics aren’t new.</h2>
        <p className="text-ink-mid text-[15px] max-w-[64ch] mb-[18px]">Every lever maps to something that already happens at scale in DeFi and traditional finance. Mintware’s job is to stack them and keep the flow pointed at your own pools.</p>
        <div className="grid grid-cols-2 max-[720px]:grid-cols-1 gap-3.5">
          {PRECEDENTS.map((pc) => (
            <div key={pc.h} className="soft-card p-[18px]">
              <div className="text-[10.5px] font-semibold tracking-[0.08em] uppercase text-peri-deep mb-[7px]">{pc.tag}</div>
              <h4 className="font-atx-display m-0 mb-1.5 text-[15.5px] font-semibold tracking-[-0.01em]">{pc.h}</h4>
              <p className="m-0 text-[13px] text-ink-mid leading-[1.55]">{pc.p}</p>
              <div className="mt-2.5 text-[11px] text-ink-soft [&_b]:text-peri-deep [&_b]:font-semibold">{pc.src}</div>
            </div>
          ))}
        </div>

        {/* fund controls */}
        <div className="soft-card p-5 mt-6">
          <div className="text-[11px] uppercase tracking-[0.16em] font-semibold text-ink-soft mb-3.5">The fund you’re comparing against</div>
          <div className="grid grid-cols-3 max-[560px]:grid-cols-1 gap-[18px]">
            <Ctl label="Gross return" val={fund.g + '%'} bare><Slider v={fund.g} min={4} max={25} step={1} on={(n) => setFund((f) => ({ ...f, g: n }))} /></Ctl>
            <Ctl label="Management fee" hint="/yr of AUM" val={fund.m + '%'} bare><Slider v={fund.m} min={0} max={4} step={0.25} on={(n) => setFund((f) => ({ ...f, m: n }))} /></Ctl>
            <Ctl label="Performance fee" hint="of gains" val={fund.p + '%'} bare><Slider v={fund.p} min={0} max={40} step={5} on={(n) => setFund((f) => ({ ...f, p: n }))} /></Ctl>
          </div>
        </div>

        <p className="text-[11.5px] text-ink-soft leading-[1.6] max-w-[82ch] mt-7">
          <b className="text-ink-mid">How the math works.</b> Floor APY = curated idle rate (Aave / Morpho / Euler). Fee APY = (daily&nbsp;volume × fee × 365 ÷ TVL) × LP&nbsp;share.
          MEV APY = daily&nbsp;volume × MEV&nbsp;bps × 365 ÷ TVL. Impermanent loss is subtracted (≈0 on stable pairs). Blended APY applies to your deposit for one year,
          <b className="text-ink-mid"> before your own taxes — crypto yield is taxable income; this is not tax advice.</b> The “off the traditional rails” benefit here is self-custody and no
          intermediary rent, not invisibility to anyone. The fund side is gross return minus management + performance fees, illiquid for the term. Testnet, unaudited — external audit gates real value.
        </p>
      </main>

      <style jsx global>{`
        .mw-rng{-webkit-appearance:none;appearance:none;width:100%;height:6px;border-radius:99px;background:linear-gradient(90deg,var(--color-peri) var(--pct,50%),color-mix(in srgb,var(--color-peri) 15%,transparent) var(--pct,50%));outline:none;cursor:pointer}
        .mw-rng::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:#fff;border:2px solid var(--color-peri);box-shadow:0 1px 4px rgba(0,0,0,.2);cursor:pointer}
        .mw-rng::-moz-range-thumb{width:18px;height:18px;border-radius:50%;background:#fff;border:2px solid var(--color-peri);cursor:pointer}
      `}</style>
    </div>
  )
}

function Ctl({ label, hint, val, sub, last, bare, children }: { label: string; hint?: string; val?: string; sub?: string; last?: boolean; bare?: boolean; children: React.ReactNode }) {
  return (
    <div className={bare ? '' : `py-3.5 ${last ? '' : 'border-b border-hair-soft'} first:pt-0`}>
      <div className="flex items-baseline justify-between gap-2 mb-[9px]">
        <span className="text-[12.5px] font-semibold text-ink">{label}{hint && <span className="text-[10.5px] text-ink-soft font-medium ml-1.5">{hint}</span>}</span>
        {val && <span className="text-[13.5px] font-semibold text-peri-deep whitespace-nowrap num">{val}</span>}
      </div>
      {children}
      {sub && <div className="text-[10.5px] text-ink-soft font-medium mt-1.5">{sub}</div>}
    </div>
  )
}

function Seg({ opts, v, on, gain }: { opts: readonly (readonly [number, string])[]; v: number; on: (n: number) => void; gain?: boolean }) {
  return (
    <div className="flex gap-1.5">
      {opts.map(([val, lbl]) => {
        const on_ = v === val
        return <button key={val} onClick={() => on(val)}
          className={`flex-1 text-[12px] font-semibold py-2 px-1 rounded-[9px] border cursor-pointer transition-colors ${on_ ? 'text-white border-transparent' : 'text-ink-mid border-hair bg-ground-cool'}`}
          style={on_ ? { background: gain ? '#11a37e' : 'var(--color-peri)' } : {}}>{lbl}</button>
      })}
    </div>
  )
}

function Wf({ rows }: { rows: (readonly [string, string, string])[] }) {
  const cls = (k: string) => k === 'neg' ? 'text-[var(--color-coral2-deep)]' : k === 'pos' ? 'text-[#11a37e]' : 'text-ink'
  return (
    <div className="mt-3 text-[12px] border-t border-hair-soft">
      {rows.map(([k, v, kind], i) => (
        <div key={i} className={`flex justify-between py-1.5 ${i < rows.length - 1 ? 'border-b border-hair-soft' : 'font-semibold text-ink'}`}>
          <span className={kind === 'tot' ? '' : 'text-ink-soft'}>{k}</span>
          <span className={`num ${cls(kind)}`}>{v}</span>
        </div>
      ))}
    </div>
  )
}
