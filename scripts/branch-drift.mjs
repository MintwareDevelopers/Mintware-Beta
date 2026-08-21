#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// branch-drift — make "which branch is real" a machine-checkable fact, not a guess.
// This repo has branches 500–670 commits behind main; every "what's built" answer
// depends on which one got checked out. Two modes:
//
//   pnpm branches:drift    → full report: every remote branch's behind/ahead vs main,
//                            with the stale ones grouped (safe-to-delete vs needs-rebase).
//   pnpm branches:check    → per-PR gate: FAIL if the CURRENT branch is egregiously
//                            behind main (i.e. you may be planning/merging off a stale base).
//
// Threshold: --max-behind=N or BRANCH_MAX_BEHIND env (default 150).
// ─────────────────────────────────────────────────────────────────────────────
import { execSync } from 'node:child_process'

const CHECK = process.argv.includes('--check')
const MAX_BEHIND = Number(
  (process.argv.find(a => a.startsWith('--max-behind=')) || '').split('=')[1] ||
  process.env.BRANCH_MAX_BEHIND || 150,
)

const sh = (cmd) => {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
  catch { return '' }
}

sh('git fetch origin main --quiet') // best-effort
const MAIN = sh('git rev-parse --verify origin/main') ? 'origin/main'
  : (sh('git rev-parse --verify main') ? 'main' : '')
if (!MAIN) {
  console.log('branch-drift: cannot resolve main (shallow clone / no history) — skipping')
  process.exit(0)
}

const drift = (ref) => {
  const out = sh(`git rev-list --left-right --count ${MAIN}...${ref}`)
  if (!out) return null
  const [behind, ahead] = out.split(/\s+/).map(Number)
  return { behind, ahead }
}

if (CHECK) {
  const head = sh('git rev-parse --abbrev-ref HEAD') || 'HEAD'
  const d = drift('HEAD')
  if (!d) { console.log('branch-drift: could not compute (shallow clone?) — skipping'); process.exit(0) }
  console.log(`branch-drift: "${head}" is ${d.behind} behind / ${d.ahead} ahead of ${MAIN} (threshold ${MAX_BEHIND})`)
  if (d.behind > MAX_BEHIND) {
    console.error(`✗ this branch is ${d.behind} commits behind ${MAIN} (> ${MAX_BEHIND}). Rebase before trusting or merging — you may be planning off a stale base (the exact "which branch is real" hazard).`)
    process.exit(1)
  }
  console.log('✓ branch is reasonably current with main')
  process.exit(0)
}

// ── full report ──
const branches = sh("git for-each-ref --format='%(refname:short)' refs/remotes/origin")
  .split('\n').map(b => b.replace(/^origin\//, '')).filter(b => b && b !== 'HEAD' && b !== 'main')
const rows = []
for (const b of branches) { const d = drift(`origin/${b}`); if (d) rows.push({ b, ...d }) }
rows.sort((a, z) => z.behind - a.behind)

console.log(`\nBranch drift vs ${MAIN} — ${rows.length} branches (threshold ${MAX_BEHIND}):\n`)
console.log('behind  ahead  branch')
for (const r of rows) console.log(`${String(r.behind).padStart(6)}  ${String(r.ahead).padStart(5)}  ${r.b}`)

const deletable = rows.filter(r => r.behind > MAX_BEHIND && r.ahead === 0)
const diverged = rows.filter(r => r.behind > MAX_BEHIND && r.ahead > 0)
console.log(`\n⚠ ${deletable.length} stale + fully behind (behind>${MAX_BEHIND}, ahead=0) → safe to delete:`)
if (deletable.length) console.log('  ' + deletable.map(r => r.b).join('\n  '))
console.log(`\n⚠ ${diverged.length} stale + diverged (behind>${MAX_BEHIND}, ahead>0) → rebase or close:`)
if (diverged.length) console.log('  ' + diverged.map(r => r.b).join('\n  '))
console.log(`\n${rows.length - deletable.length - diverged.length} branch(es) reasonably current.`)
