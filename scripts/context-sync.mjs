#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// context-sync — regenerate drift-prone reference lists FROM THE CODEBASE into
// AUTO-managed blocks in the context layer (.claude/*). This is Layer 1 of the
// anti-drift system: facts the code already knows (routes, crons, pages, test
// suites, contracts, public env flags) are derived here, never hand-maintained,
// so they physically cannot fall behind the code.
//
//   pnpm context:sync     → rewrite AUTO blocks in place
//   pnpm context:check    → exit 1 if any AUTO block is stale (for CI/pre-commit)
//
// An AUTO block looks like:
//   <!-- AUTO:crons -->
//   …generated…
//   <!-- /AUTO:crons -->
// NEVER hand-edit between the markers — your edit is overwritten on next sync.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const CHECK = process.argv.includes('--check')

// ── fs walk ──
const IGNORE = new Set(['node_modules', '.next', 'out', '.git', 'artifacts', 'cache', 'coverage', 'lib'])
function walk(dir, keep, acc = []) {
  let entries
  try { entries = readdirSync(join(ROOT, dir || '.'), { withFileTypes: true }) } catch { return acc }
  for (const e of entries) {
    // only ignore top-level forge-lib/build dirs, not lib/ under repo root — handled per-call
    if (e.isDirectory() && (e.name === 'node_modules' || e.name === '.next' || e.name === 'out' || e.name === '.git' || e.name === 'cache' || e.name === 'artifacts')) continue
    const rel = dir ? `${dir}/${e.name}` : e.name
    if (e.isDirectory()) walk(rel, keep, acc)
    else if (keep(rel)) acc.push(rel)
  }
  return acc
}

// ── route derivation ──
const dropGroups = (p) => p.split('/').filter((s) => s && !/^\(.*\)$/.test(s)).join('/')
const pageRoute = (f) => {
  const p = '/' + dropGroups(f.replace(/^app/, '').replace(/\/page\.tsx$/, ''))
  return p === '/' ? '/' : p.replace(/\/$/, '')
}
const apiRoute = (f) => '/' + dropGroups(f.replace(/^app/, '').replace(/\/route\.ts$/, ''))

// ── generators (keyed by AUTO block name) ──
const generators = {
  crons() {
    const v = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'))
    const rows = (v.crons || []).map((c) => `| \`${c.path}\` | \`${c.schedule}\` |`)
    return ['| Path | Schedule |', '|---|---|', ...rows].join('\n')
  },
  pages() {
    const rows = walk('app', (f) => f.endsWith('/page.tsx'))
      .map((f) => ({ r: pageRoute(f), f }))
      .sort((a, b) => a.r.localeCompare(b.r))
      .map((x) => `| \`${x.r}\` | \`${x.f}\` |`)
    return ['| Route | File |', '|---|---|', ...rows].join('\n')
  },
  'api-routes'() {
    const rows = walk('app', (f) => f.endsWith('/route.ts'))
      .map((f) => apiRoute(f))
      .sort()
      .map((r) => `\`${r}\``)
    return `${rows.length} internal API routes:\n\n` + rows.join(' · ')
  },
  'test-suites'() {
    const files = walk('app', (f) => f.endsWith('.test.ts'))
      .concat(['lib', 'services'].flatMap((d) => walk(d, (f) => f.endsWith('.test.ts'))))
      .sort()
    return `${files.length} Vitest suites:\n` + files.map((f) => `- \`${f}\``).join('\n')
  },
  contracts() {
    const files = ['contracts-v4', 'contracts-ai']
      .flatMap((d) => walk(d, (f) => f.endsWith('.sol')))
      .filter((f) => f.includes('/src/') || f.includes('/script/'))
      .sort()
    return files.map((f) => `- \`${f}\``).join('\n')
  },
  // Deploy truth, generated from the ONE committed record (config/deployments.json) + the src tree.
  // Kills the "built ≠ deployed" ghost: a session reads this table, and anything not in it is NOT deployed.
  'build-status'() {
    let dep
    try { dep = JSON.parse(readFileSync(join(ROOT, 'config/deployments.json'), 'utf8')) } catch {
      return '_No `config/deployments.json` — deploy status is unverifiable. Add the one committed deploy record._'
    }
    const rows = []
    let full = 0, gaps = 0
    const deployedNames = new Set()
    for (const env of ['mainnet', 'testnet']) {
      for (const [chain, contracts] of Object.entries(dep[env] || {})) {
        for (const [name, i] of Object.entries(contracts)) {
          if (name.startsWith('_')) continue
          deployedNames.add(name)
          if (i.address) full++; else gaps++
          const addr = i.address ? `\`${i.address}\`` : '⚠ **address missing**'
          rows.push({ env, name, cell: `| \`${name}\` | ${env} · ${chain} | ${addr} | ${i.status || '?'} |` })
        }
      }
    }
    rows.sort((a, b) => (a.env === b.env ? a.name.localeCompare(b.name) : a.env === 'mainnet' ? -1 : 1))
    const srcNames = [...new Set(
      ['contracts-v4', 'contracts-ai']
        .flatMap((d) => walk(d, (f) => f.endsWith('.sol')))
        .filter((f) => f.includes('/src/'))
        .map((f) => f.split('/').pop().replace(/\.sol$/, ''))
    )].sort()
    const undeployed = srcNames.filter((n) => !deployedNames.has(n))
    return [
      '_Source: `config/deployments.json` (the one committed deploy record). **No entry here = NOT deployed** — never infer a deployment from prose._',
      '',
      '| Contract | Env · Chain | Address | Status |',
      '|---|---|---|---|',
      ...rows.map((r) => r.cell),
      '',
      `**${full} recorded with a full address, ${gaps} flagged as a GAP** (truncated in the rules — complete from the broadcast).`,
      `**${undeployed.length} of ${srcNames.length} \`src\` contracts have NO deploy record** (testnet-only stack, libraries, abstracts, or genuinely undeployed — assume NOT deployed unless listed above).`,
    ].join('\n')
  },
  'public-env-flags'() {
    const src = ['app', 'lib', 'components'].flatMap((d) => walk(d, (f) => /\.(ts|tsx)$/.test(f)))
    const found = new Set()
    for (const f of src) {
      const txt = readFileSync(join(ROOT, f), 'utf8')
      for (const m of txt.matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g)) found.add(m[1])
    }
    return [...found].sort().map((k) => `- \`${k}\``).join('\n')
  },
}

// ── marker engine ──
const MARK = /<!-- AUTO:([a-z-]+) -->[\s\S]*?<!-- \/AUTO:\1 -->/g
const TARGETS = [
  '.claude/STATE.md',
  '.claude/rules/deployments.md',
  '.claude/rules/api.md',
  '.claude/rules/architecture.md',
  '.claude/rules/testing.md',
  '.claude/rules/smart-contracts.md',
]

let stale = 0
const seen = []
for (const t of TARGETS) {
  let txt
  try { txt = readFileSync(join(ROOT, t), 'utf8') } catch { continue }
  const next = txt.replace(MARK, (full, key) => {
    const gen = generators[key]
    if (!gen) { console.error(`! ${t}: unknown AUTO key "${key}" (no generator)`); return full }
    seen.push(key)
    return `<!-- AUTO:${key} -->\n<!-- generated by scripts/context-sync.mjs — do not edit by hand -->\n${gen()}\n<!-- /AUTO:${key} -->`
  })
  if (next !== txt) {
    stale++
    if (CHECK) console.error(`✗ stale: ${t}`)
    else { writeFileSync(join(ROOT, t), next); console.log(`✓ synced ${t}`) }
  }
}

if (CHECK && stale) {
  console.error(`\n${stale} file(s) have stale AUTO blocks — run: pnpm context:sync`)
  process.exit(1)
}
console.log(stale ? `\n${stale} file(s) updated (${seen.length} AUTO blocks).` : `All AUTO blocks up to date (${seen.length} blocks).`)
