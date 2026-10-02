// ModelDiagram — a tiny declarative box-and-arrow diagram for /how-it-works, the V1 deposit page, the
// homepages and (as exported static SVG) /deck + /dataroom + /angels. Pure inline SVG, no hooks, no libs.
//
// Each diagram is authored TWICE — a `wide` layout (desktop, ~960 wide) and a `tall` layout (phone,
// 360 wide) — swapped by a container query at 700px so text stays legible instead of shrinking. Edges are
// routed orthogonally between box sides; when two boxes overlap on the cross axis the edge runs
// straight through the middle of the overlap. `back` edges (money/claims flowing back to the user)
// are dashed. Every node can carry an honesty status pill: testnet · built · roadmap.

export type Status = 'testnet' | 'built' | 'roadmap'
export type Tone = 'you' | 'mintware' | 'external'
type Side = 'l' | 'r' | 't' | 'b'
type Box = { x: number; y: number; w: number; h: number }
export type Layout = 'wide' | 'tall'
type Pt = [number, number]

export type DNode = {
  id: string
  title: string
  lines?: string[]
  tone: Tone
  status?: Status
  wide: Box & { title?: string; lines?: string[] }
  tall: Box & { title?: string; lines?: string[] }
}

export type DEdge = {
  from: string
  to: string
  label?: string
  /** dashed return flow (value/claims back toward the user) */
  back?: boolean
  /** shift both anchors along their side (px) — separates a forward/back pair */
  offset?: number
  /** override sides / the loop coordinate per layout; `label: null` hides the label there */
  wide?: { from?: Side; to?: Side; via?: number; offset?: number; label?: string | null }
  tall?: { from?: Side; to?: Side; via?: number; offset?: number; label?: string | null }
  only?: Layout
}

export type DiagramSpec = {
  id: string
  title: string
  description: string
  wide: { w: number; h: number }
  tall: { w: number; h: number }
  nodes: DNode[]
  edges: DEdge[]
}

export type Theme = 'light' | 'dark'

// Concrete colours, not CSS vars — the same SVG is exported into the sandboxed deck / data-room
// iframes (scripts/export-diagrams.tsx), where the site's tokens don't exist. Light mirrors the v2
// marketing tokens; dark mirrors the V1 app shell (#0B0B12 ground, #12121C panels).
type Palette = {
  figBg: string; figBorder: string; ink: string; inkMid: string; fwd: string; back: string; halo: string
  tone: Record<Tone, { fill: string; stroke: string }>
  status: Record<Status, { fg: string; bg: string; border: string }>
}

const PALETTE: Record<Theme, Palette> = {
  light: {
    figBg: '#FFFFFF', figBorder: 'rgba(23,23,31,0.08)', ink: '#17171F', inkMid: '#55555F',
    fwd: '#5A57DE', back: '#E88A67', halo: '#FFFFFF',
    tone: {
      you: { fill: '#FFFFFF', stroke: '#6C6CF0' },
      mintware: { fill: '#EFEFFE', stroke: 'rgba(108,108,240,0.38)' },
      external: { fill: '#F5F5F8', stroke: 'rgba(23,23,31,0.16)' },
    },
    status: {
      testnet: { fg: '#5A57DE', bg: '#ECECFD', border: 'rgba(108,108,240,0.35)' },
      built: { fg: '#1F7F6F', bg: '#E4F4F1', border: 'rgba(42,158,138,0.4)' },
      roadmap: { fg: '#B8603F', bg: '#FDEEE7', border: 'rgba(232,138,103,0.45)' },
    },
  },
  dark: {
    figBg: '#12121C', figBorder: 'rgba(255,255,255,0.07)', ink: '#F4F4FA', inkMid: '#9B9BAD',
    fwd: '#8A82F4', back: '#F0A07F', halo: '#12121C',
    tone: {
      you: { fill: '#0E0E16', stroke: '#8A82F4' },
      mintware: { fill: '#1C1B33', stroke: 'rgba(138,130,244,0.45)' },
      external: { fill: '#181822', stroke: 'rgba(255,255,255,0.14)' },
    },
    status: {
      testnet: { fg: '#A9A3F7', bg: '#23213F', border: 'rgba(138,130,244,0.45)' },
      built: { fg: '#5FD3BD', bg: '#12302A', border: 'rgba(95,211,189,0.4)' },
      roadmap: { fg: '#F4A183', bg: '#3A2219', border: 'rgba(244,161,131,0.4)' },
    },
  },
}

const STATUS_LABEL: Record<Status, string> = { testnet: 'Testnet', built: 'Built', roadmap: 'Roadmap' }

const center = (b: Box): Pt => [b.x + b.w / 2, b.y + b.h / 2]

function autoSides(a: Box, b: Box): [Side, Side] {
  const [ax, ay] = center(a)
  const [bx, by] = center(b)
  const dx = bx - ax
  const dy = by - ay
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ['r', 'l'] : ['l', 'r']
  return dy >= 0 ? ['b', 't'] : ['t', 'b']
}

// Anchor on a side. For a straight pair (r↔l or b↔t) with cross-axis overlap, use the middle of the
// overlap so the connector is a single straight line.
function anchor(box: Box, side: Side, other: Box, otherSide: Side, offset: number): Pt {
  const horiz = side === 'l' || side === 'r'
  const straight = horiz ? otherSide === 'l' || otherSide === 'r' : otherSide === 't' || otherSide === 'b'
  if (horiz) {
    let y = box.y + box.h / 2
    if (straight && side !== otherSide) {
      const lo = Math.max(box.y, other.y)
      const hi = Math.min(box.y + box.h, other.y + other.h)
      if (hi > lo) y = (lo + hi) / 2
    }
    return [side === 'l' ? box.x : box.x + box.w, y + offset]
  }
  let x = box.x + box.w / 2
  if (straight && side !== otherSide) {
    const lo = Math.max(box.x, other.x)
    const hi = Math.min(box.x + box.w, other.x + other.w)
    if (hi > lo) x = (lo + hi) / 2
  }
  return [x + offset, side === 't' ? box.y : box.y + box.h]
}

function route(p1: Pt, s1: Side, p2: Pt, s2: Side, via?: number): Pt[] {
  const h1 = s1 === 'l' || s1 === 'r'
  const h2 = s2 === 'l' || s2 === 'r'
  if (h1 && h2) {
    if (s1 === s2) {
      const vx = via ?? (s1 === 'r' ? Math.max(p1[0], p2[0]) + 28 : Math.min(p1[0], p2[0]) - 28)
      return [p1, [vx, p1[1]], [vx, p2[1]], p2]
    }
    if (p1[1] === p2[1]) return [p1, p2]
    const mx = via ?? (p1[0] + p2[0]) / 2
    return [p1, [mx, p1[1]], [mx, p2[1]], p2]
  }
  if (!h1 && !h2) {
    if (s1 === s2) {
      const vy = via ?? (s1 === 'b' ? Math.max(p1[1], p2[1]) + 28 : Math.min(p1[1], p2[1]) - 28)
      return [p1, [p1[0], vy], [p2[0], vy], p2]
    }
    if (p1[0] === p2[0]) return [p1, p2]
    const my = via ?? (p1[1] + p2[1]) / 2
    return [p1, [p1[0], my], [p2[0], my], p2]
  }
  if (h1) return [p1, [p2[0], p1[1]], p2]
  return [p1, [p1[0], p2[1]], p2]
}


/**
 * One layout of one diagram as a bare <svg>. Exported so scripts/export-diagrams.tsx can render it to
 * static markup for the deck / data-room iframes; pages use <ModelDiagram>, which picks the layout.
 */
export function DiagramSvg({
  spec, layout, theme = 'light', fontFamily,
}: { spec: DiagramSpec; layout: Layout; theme?: Theme; fontFamily?: string }) {
  const pal = PALETTE[theme]
  const size = spec[layout]
  const byId = new Map(spec.nodes.map((n) => [n.id, n]))
  const mk = `mwd-${spec.id}-${layout}-${theme}`
  const titleId = `${mk}-title`
  const descId = `${mk}-desc`

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${size.w} ${size.h}`}
      width="100%"
      role="img"
      aria-labelledby={`${titleId} ${descId}`}
      style={{ display: 'block', height: 'auto', fontFamily: fontFamily ?? 'inherit' }}
    >
      <title id={titleId}>{spec.title}</title>
      <desc id={descId}>{spec.description}</desc>
      <defs>
        <marker id={`${mk}-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 1 L9 5 L0 9 z" fill={pal.fwd} />
        </marker>
        <marker id={`${mk}-arrow-back`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 1 L9 5 L0 9 z" fill={pal.back} />
        </marker>
      </defs>

      {/* edges first so boxes sit on top of line ends */}
      {spec.edges.map((e, i) => {
        if (e.only && e.only !== layout) return null
        const a = byId.get(e.from)
        const b = byId.get(e.to)
        if (!a || !b) return null
        const ov = e[layout]
        const [autoFrom, autoTo] = autoSides(a[layout], b[layout])
        const s1 = ov?.from ?? autoFrom
        const s2 = ov?.to ?? autoTo
        const off = ov?.offset ?? e.offset ?? 0
        const p1 = anchor(a[layout], s1, b[layout], s2, off)
        const p2 = anchor(b[layout], s2, a[layout], s1, off)
        const pts = route(p1, s1, p2, s2, ov?.via)
        const d = pts.map((p, j) => `${j ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ')
        const label = ov && 'label' in ov ? ov.label : e.label

        // label on the longest segment
        let lp: { x: number; y: number; anchor: 'start' | 'middle' | 'end' } | null = null
        if (label) {
          let best = 0
          for (let j = 1; j < pts.length; j++) {
            const [x0, y0] = pts[j - 1]
            const [x1, y1] = pts[j]
            const len = Math.abs(x1 - x0) + Math.abs(y1 - y0)
            if (len <= best) continue
            best = len
            if (y0 === y1) lp = { x: (x0 + x1) / 2, y: y0 + (e.back ? 15 : -7), anchor: 'middle' }
            else lp = { x: x0 + (e.back ? 8 : -8), y: (y0 + y1) / 2 + 4, anchor: e.back ? 'start' : 'end' }
          }
        }
        const color = e.back ? pal.back : pal.fwd
        return (
          <g key={i}>
            <path
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={1.6}
              strokeLinejoin="round"
              strokeDasharray={e.back ? '5 4' : undefined}
              markerEnd={`url(#${mk}-arrow${e.back ? '-back' : ''})`}
            />
            {lp && label && (
              <text
                x={lp.x}
                y={lp.y}
                textAnchor={lp.anchor}
                fontSize={11}
                fontWeight={600}
                fill={color}
                stroke={pal.halo}
                strokeWidth={4}
                strokeLinejoin="round"
                paintOrder="stroke"
              >
                {label}
              </text>
            )}
          </g>
        )
      })}

      {spec.nodes.map((n) => {
        const box = n[layout]
        const tone = pal.tone[n.tone]
        const title = box.title ?? n.title
        const lines = box.lines ?? n.lines ?? []
        const blockH = 18 + lines.length * 15
        const top = box.y + (box.h - blockH) / 2 + 13
        const st = n.status ? { ...pal.status[n.status], label: STATUS_LABEL[n.status] } : null
        const pillW = st ? st.label.length * 6.4 + 16 : 0
        return (
          <g key={n.id}>
            <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={14} fill={tone.fill} stroke={tone.stroke} strokeWidth={n.tone === 'you' ? 1.6 : 1.2} />
            <text x={box.x + 14} y={top} fontSize={14} fontWeight={600} fill={pal.ink} letterSpacing="-0.01em">
              {title}
            </text>
            {lines.map((l, j) => (
              <text key={j} x={box.x + 14} y={top + 18 + j * 15} fontSize={11.5} fill={pal.inkMid}>
                {l}
              </text>
            ))}
            {st && (
              <g>
                <rect x={box.x + box.w - pillW - 12} y={box.y - 9} width={pillW} height={18} rx={9} fill={st.bg} stroke={st.border} />
                <text x={box.x + box.w - 12 - pillW / 2} y={box.y + 4} textAnchor="middle" fontSize={9.5} fontWeight={700} letterSpacing="0.06em" fill={st.fg}>
                  {st.label.toUpperCase()}
                </text>
              </g>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/**
 * A diagram in its card. The wide/tall swap is a CONTAINER query (not a viewport one), so the same
 * diagram reads right full-width on /how-it-works and inside a narrow column (e.g. the V1 deposit page).
 */
export function ModelDiagram({
  spec, theme = 'light', className = '',
}: { spec: DiagramSpec; theme?: Theme; className?: string }) {
  const pal = PALETTE[theme]
  return (
    <figure
      className={`@container rounded-[20px] border p-6 max-[760px]:p-4 ${className}`}
      style={{ background: pal.figBg, borderColor: pal.figBorder }}
    >
      <div className="@max-[700px]:hidden">
        <DiagramSvg spec={spec} layout="wide" theme={theme} />
      </div>
      <div className="hidden @max-[700px]:block mx-auto max-w-[420px]">
        <DiagramSvg spec={spec} layout="tall" theme={theme} />
      </div>
    </figure>
  )
}

/** Shared key: node tones + status pills + edge styles. */
export function DiagramLegend({ theme = 'light' }: { theme?: Theme }) {
  const pal = PALETTE[theme]
  const swatch = (t: Tone, label: string) => (
    <span className="inline-flex items-center gap-2">
      <span className="inline-block w-4 h-3 rounded-[4px] border" style={{ background: pal.tone[t].fill, borderColor: pal.tone[t].stroke }} />
      {label}
    </span>
  )
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5 text-[12.5px]" style={{ color: pal.inkMid }}>
      {swatch('you', 'You')}
      {swatch('mintware', 'Mintware contracts')}
      {swatch('external', 'Third-party venue')}
      <span className="inline-flex items-center gap-2">
        <svg width="26" height="8" aria-hidden><path d="M0 4 H26" stroke={pal.fwd} strokeWidth="1.6" /></svg>
        Capital in
      </span>
      <span className="inline-flex items-center gap-2">
        <svg width="26" height="8" aria-hidden><path d="M0 4 H26" stroke={pal.back} strokeWidth="1.6" strokeDasharray="5 4" /></svg>
        Value back
      </span>
      {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
        <span
          key={s}
          className="inline-flex items-center rounded-full px-2.5 py-[3px] text-[10px] font-bold tracking-[0.06em] uppercase border"
          style={{ color: pal.status[s].fg, background: pal.status[s].bg, borderColor: pal.status[s].border }}
        >
          {STATUS_LABEL[s]}
        </span>
      ))}
    </div>
  )
}
