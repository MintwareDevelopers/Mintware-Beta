// Reusable "Codex live-watch style" adversarial second-look review.
//
// Modeled directly on what made this session's Codex live-watch reviews effective across the LP Gateway
// fee-conversion work: diff-scoped (not a blind whole-repo sweep), multi-dimension (not just "find bugs"),
// checks the delivered work against the ORIGINAL ask (not just internal consistency), and — critically —
// VERIFIES EMPIRICALLY by actually running the relevant tests/build rather than trusting reasoning alone.
//
// Usage:
//   Workflow({ name: 'adversarial-review', args: {
//     baseRef: 'origin/main',        // optional, default 'origin/main' — reviews `git diff baseRef...HEAD`
//     files: ['lib/foo.ts', ...],    // optional — review these exact files instead of a git diff
//     context: 'the original user ask this work was supposed to satisfy, verbatim if possible',
//     dimensions: ['atomicity', ...] // optional — narrow to a subset of DIMENSIONS below (default: all)
//   }})
//
// Needs explicit user opt-in per turn (say "run the adversarial-review workflow" or similar) — this file
// alone does not auto-run. See also: /code-review ultra (Anthropic's own multi-agent cloud review,
// billed, launched via the skill, not this tool) for a heavier alternative covering a whole branch/PR.

export const meta = {
  name: 'adversarial-review',
  description: 'Codex-style adversarial second-look: diff-scoped, multi-dimension, empirically verified',
  phases: [
    { title: 'Scope', detail: 'identify the diff and the original ask' },
    { title: 'Review', detail: 'parallel dimension-based adversarial findings' },
    { title: 'Verify', detail: 'refute + empirically RUN tests/build for each finding' },
    { title: 'Synthesize', detail: 'report only what survives both checks' },
  ],
}

// Each dimension is a lens Codex actually caught real bugs through this session. Add/remove via
// args.dimensions rather than editing this list for a one-off narrower review.
const DIMENSIONS = [
  {
    key: 'atomicity',
    prompt: `Look for non-atomic operations presented as if they were atomic: multi-step sequences (read
      then later read, or read-then-write) that assume nothing else can happen in between, when in fact
      concurrent callers/processes/shared state could interleave. A real example this session: a balance
      read before a transaction and another balance read after it, subtracted to measure "this transaction's
      effect" — wrong whenever anything else touches that same balance in the window. Also check
      idempotency claims: does a retry of the same operation actually produce the same result / avoid
      double-crediting, or only "usually"?`,
  },
  {
    key: 'durability',
    prompt: `For every place that claims to durably record/persist something (a DB write, a queued job, a
      status flag), verify: (1) is the write's own result/error actually checked, or just fired-and-forgotten;
      (2) does EVERY exit path (including early returns on failure elsewhere in the function) still reach
      that write, or can a failure earlier in the sequence skip it entirely, silently losing the record of
      something that already happened for real (e.g. an on-chain tx, an external side effect). A real
      example this session: several failure-return paths skipped the DB insert entirely, so a real
      submitted transaction's hash was recorded nowhere in the app's own tables.`,
  },
  {
    key: 'test-honesty',
    prompt: `For each new/changed test, check whether it actually exercises the REAL code path it claims to,
      or a mock/stub that no longer matches reality (e.g. mocking a function whose real behavior just
      changed, so the test still "passes" but proves nothing about the new behavior). Check that assertions
      are specific enough to fail if the implementation regressed — not so loose (partial matches, missing
      fields) that a broken implementation would still pass. Flag any test whose title/comment no longer
      describes what it actually tests after edits.`,
  },
  {
    key: 'scope-honesty',
    prompt: `Compare what was actually delivered against the ORIGINAL user ask (given below as context, if
      provided) — flag anywhere the work quietly narrowed scope and labeled the narrower version "done" or
      "closed" without saying so plainly. A real example this session: framing genuine failure/retry/
      reconciliation work as optional "new scope" when the original directive ("finish X") clearly implied
      it. Also flag any comment or doc claim asserting something is complete/safe/verified that the code
      doesn't actually support once you read it.`,
  },
  {
    key: 'doc-accuracy',
    prompt: `Cross-check every factual claim in changed comments/docs against the ACTUAL current code —
      not just internal consistency of the prose. Look specifically for: (1) a claim that some code path
      does X when reading it shows it does something narrower or different; (2) a claim that "nothing does
      Y yet" when something actually already does; (3) stale claims left over from an earlier version of
      the code that a later edit invalidated without updating the comment.`,
  },
]

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          summary: { type: 'string' },
          failure_scenario: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        },
        required: ['title', 'summary', 'failure_scenario'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    real: { type: 'boolean' },
    reasoning: { type: 'string' },
    empirical_evidence: { type: 'string' },
  },
  required: ['real', 'reasoning'],
}

phase('Scope')
const context = args?.context ?? ''
const baseRef = args?.baseRef ?? 'origin/main'
const explicitFiles = Array.isArray(args?.files) ? args.files : null
const wantedDimensions = Array.isArray(args?.dimensions) && args.dimensions.length
  ? DIMENSIONS.filter((d) => args.dimensions.includes(d.key))
  : DIMENSIONS

const scope = await agent(
  explicitFiles
    ? `Read and summarize the current content and purpose of these files, preparing for an adversarial
       code review: ${explicitFiles.join(', ')}.
       ${context ? `Original user intent/ask this work was supposed to satisfy: ${context}` : ''}`
    : `Run \`git log ${baseRef}..HEAD --oneline\` and \`git diff ${baseRef}...HEAD\` in the current repo.
       Summarize what changed and why (read the commit messages), and list every changed file path exactly.
       ${context ? `Original user intent/ask this work was supposed to satisfy, to check the diff against: ${context}` : ''}`,
  {
    schema: {
      type: 'object',
      properties: { files: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } },
      required: ['files', 'summary'],
    },
  },
)
log(`Scoped ${scope.files.length} changed file(s)${scope.files.length ? ': ' + scope.files.slice(0, 10).join(', ') + (scope.files.length > 10 ? '…' : '') : ''}`)

phase('Review')
const dimensionResults = await parallel(
  wantedDimensions.map((d) => () =>
    agent(
      `You are doing an ADVERSARIAL second-look code review. The standard to match: a reviewer who
       independently re-runs tests/scripts rather than trusting claims, disputes any "this is closed/done"
       framing that doesn't match the original ask, and reports REAL, concrete bugs — never style nits or
       hypothetical preferences.

       Dimension: ${d.key}
       ${d.prompt}

       Files changed: ${scope.files.join(', ')}
       Change summary: ${scope.summary}
       ${context ? `Original user ask (check the delivered work actually satisfies this, not a narrowed version): ${context}` : ''}

       Read the ACTUAL current file contents (not just a diff) — a bug may involve code the diff didn't
       touch directly. For each finding: file path, line if applicable, a one-sentence summary, and a
       CONCRETE failure scenario (specific inputs/timing/state -> wrong outcome, not "this could theoretically..."
       phrasing). An empty findings array is a fine, honest answer if you genuinely find nothing real.`,
      { phase: 'Review', schema: FINDINGS_SCHEMA, label: `review:${d.key}` },
    ).then((r) => (r?.findings ?? []).map((f) => ({ ...f, dimension: d.key }))),
  ),
)
const allFindings = dimensionResults.flat()
log(`${allFindings.length} raw finding(s) across ${wantedDimensions.length} dimension(s)`)

if (allFindings.length === 0) {
  return { confirmed: [], totalRaw: 0, note: 'No findings from any dimension — nothing to verify.' }
}

phase('Verify')
const verified = await parallel(
  allFindings.map((f) => () =>
    parallel([
      () =>
        agent(
          `Adversarially try to REFUTE this code-review finding. Actively look for reasons it might be
           wrong, already handled elsewhere in the code, or not actually reachable. Default to real=true
           only if you genuinely cannot refute it after checking the real code.
           Finding: ${JSON.stringify(f)}`,
          { phase: 'Verify', schema: VERDICT_SCHEMA, label: `refute:${f.title}` },
        ),
      () =>
        agent(
          `Empirically check this code-review finding by actually RUNNING the relevant command — the
           specific test file (vitest/forge), tsc --noEmit, or a small repro script — and reading its real
           output. Do not just reason about whether it's true; run something and report exactly what you
           ran and what it showed. If nothing is realistically runnable to check this specific finding, say
           so explicitly rather than fabricating a result.
           Finding: ${JSON.stringify(f)}`,
          { phase: 'Verify', schema: VERDICT_SCHEMA, label: `empirical:${f.title}` },
        ),
    ]).then(([refute, empirical]) => ({
      finding: f,
      refuteVerdict: refute,
      empiricalVerdict: empirical,
      // Require BOTH an adversarial pass that couldn't refute it AND an empirical check that didn't
      // contradict it — matches the two-track discipline (reasoning + actually running things) that made
      // the source reviews trustworthy rather than just plausible-sounding.
      confirmed: Boolean(refute?.real) && Boolean(empirical?.real),
    })),
  ),
)

phase('Synthesize')
const confirmed = verified
  .filter((v) => v.confirmed)
  .map((v) => ({
    ...v.finding,
    refutation_check: v.refuteVerdict?.reasoning,
    empirical_evidence: v.empiricalVerdict?.empirical_evidence,
  }))
log(`${confirmed.length}/${allFindings.length} finding(s) survived adversarial + empirical verification`)

return { confirmed, totalRaw: allFindings.length, allResults: verified }
