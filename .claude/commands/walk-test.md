---
description: Run the ICM walk-test audit on the context layer and report drift
---

Run a **walk-test** on Mintware's AI-context layer — the recurring drift check (Layer 3 of
`.claude/CONTEXT-MAP.md`). Goal: find where the docs no longer match the code, before an agent
trusts a stale claim.

## Steps

1. **Regenerate first.** Run `pnpm context:sync`. If it changes anything, the `AUTO` blocks were
   stale — note which, and include the fix (the sync itself) in your report.
2. **Read the layer cold**, as an agent with no memory:
   - `.claude/STATE.md` (front door), `CLAUDE.md`, `.claude/CONTEXT-MAP.md`
   - `.claude/rules/*.md`
   - `docs/` entry docs (README/SUMMARY) + any topic docs the router points to
   - session `memory/MEMORY.md` + the memories it indexes
3. **Cross-check load-bearing claims against the actual code** (grep/read): do referenced routes,
   pages, env flags, crons, contracts, files, and npm scripts still exist? Spot-check ~15–20 of the
   highest-value claims — don't trust the prose.
4. **Apply the ICM walk-test criteria** and group findings by them:
   - **Orientation** — can a fresh agent answer "where am I / where do I go" from STATE.md + ≤2 reads? Any dead router links?
   - **One home per fact** — any fact duplicated across files (drift risk)? Name the home it should live in.
   - **Staleness** — any claim that contradicts current code (cite stale value → real value)?
   - **Dead content** — anything shelved (RWA, Campaigns) presented as current instead of banner'd/archived?
   - **Index accuracy** — does `MEMORY.md` match its topic files? Orphans or superseded entries?

## Output

A tight report, most-severe first: `file · category · severity · one-line finding · concrete fix`.
End with the top 3–5 highest-leverage fixes. **Report only — do not edit** unless the user then asks
you to apply the fixes.
