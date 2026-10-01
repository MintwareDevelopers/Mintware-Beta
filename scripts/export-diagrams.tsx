// pnpm diagrams:export — renders the /how-it-works diagrams to static SVG and splices them into the
// investor markup strings (/deck, /angels, /dataroom). Those pages are fixed HTML inside sandboxed
// iframes (no React, no site CSS tokens), so they can't import <ModelDiagram>; this keeps them showing
// the SAME picture as the site. Re-run after editing components/marketing/how/diagrams.ts.
//
// Each target is a marker pair already present in the markup file:
//   <!--mw-diagram:KEY--> …generated… <!--/mw-diagram:KEY-->
// Everything between the markers is replaced. A missing marker fails loudly (never silently skipped).

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DiagramSpec } from '../components/marketing/how/ModelDiagram'

// jiti compiles JSX with the classic runtime (React.createElement), and ModelDiagram.tsx — written for
// Next's automatic runtime — has no React import. Expose React globally BEFORE loading it.
;(globalThis as { React?: typeof React }).React = React
const { DiagramSvg } = await import('../components/marketing/how/ModelDiagram')
const { V1_LP, V2_SPEND, V2_TREASURY } = await import('../components/marketing/how/diagrams')

const FONT = "'Space Grotesk', system-ui, sans-serif"

const TARGETS: { file: string; key: string; spec: DiagramSpec }[] = [
  { file: 'app/deck/deckMarkup.ts', key: 'deck-spend', spec: V2_SPEND },
  { file: 'app/angels/angelsMarkup.ts', key: 'angels-treasury', spec: V2_TREASURY },
  { file: 'app/dataroom/dataroomMarkup.ts', key: 'dataroom-treasury', spec: V2_TREASURY },
  { file: 'app/dataroom/dataroomMarkup.ts', key: 'dataroom-v1-lp', spec: V1_LP },
]

// Same container-query swap as <ModelDiagram>: wide layout, tall layout below 700px of card width.
const STYLE =
  '.mwd{container-type:inline-size;background:#fff;border:1px solid rgba(23,23,31,.08);border-radius:16px;padding:18px;margin-top:20px}' +
  '.mwd-tall{display:none;max-width:420px;margin:0 auto}' +
  '@container (max-width:700px){.mwd-wide{display:none}.mwd-tall{display:block}}'

function snippet(spec: DiagramSpec): string {
  const wide = renderToStaticMarkup(<DiagramSvg spec={spec} layout="wide" fontFamily={FONT} />)
  const tall = renderToStaticMarkup(<DiagramSvg spec={spec} layout="tall" fontFamily={FONT} />)
  return (
    `<div class="mwd"><style>${STYLE}</style>` +
    `<div class="mwd-wide">${wide}</div><div class="mwd-tall">${tall}</div>` +
    `<div style="font-size:11px;color:#8A8A9E;margin-top:10px">Diagram of the design, not projected returns. Status labels: testnet = running on testnet with mock tokens · built = tested, not live.</div>` +
    `</div>`
  )
}

const root = resolve(__dirname, '..')
const byFile = new Map<string, string>()
for (const t of TARGETS) {
  const path = resolve(root, t.file)
  const src = byFile.get(path) ?? readFileSync(path, 'utf8')
  const open = `<!--mw-diagram:${t.key}-->`
  const close = `<!--/mw-diagram:${t.key}-->`
  const i = src.indexOf(open)
  const j = src.indexOf(close)
  if (i < 0 || j < i) throw new Error(`${t.file}: marker ${open} … ${close} not found`)
  const html = snippet(t.spec)
  // The markup files are JS template literals — generated HTML must not be able to break out of one.
  if (html.includes('`') || html.includes('${')) throw new Error(`${t.key}: output contains a template-literal token`)
  byFile.set(path, src.slice(0, i + open.length) + html + src.slice(j))
  console.log(`✓ ${t.file} ← ${t.key} (${t.spec.id})`)
}
for (const [path, src] of byFile) writeFileSync(path, src)
