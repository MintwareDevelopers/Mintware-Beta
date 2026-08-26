// Posts the launch cast for @mintware-agent — the locked-in "reply to get scored" opener.
// Scores the team treasury wallet live (not hardcoded) so the seeded example is always current.
//
//   node --env-file=.env.local scripts/post-first-farcaster-cast.mjs
//
// Review the printed text before this actually runs — it posts for real, no dry-run flag.
// Re-running posts a duplicate cast; this is meant to run once.

// Hits the deployed score API rather than importing lib/attribution/*.ts directly — this is a
// plain Node script (no TS loader registered in this repo's scripts/), and it doubles as a
// smoke test of the real production endpoint rather than reimporting internal logic.
const SCORE_API_BASE = process.env.MINTWARE_APP_URL ?? 'https://mintware.finance'

const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY
const NEYNAR_SIGNER_UUID = process.env.NEYNAR_SIGNER_UUID
// Public team wallet — seeded example for the launch cast, not a secret.
const SEED_ADDRESS = process.env.NEXT_PUBLIC_MW_TREASURY_ADDRESS

if (!NEYNAR_API_KEY || !NEYNAR_SIGNER_UUID) {
  console.error('NEYNAR_API_KEY / NEYNAR_SIGNER_UUID not set')
  process.exit(1)
}
if (!SEED_ADDRESS) {
  console.error('NEXT_PUBLIC_MW_TREASURY_ADDRESS not set — need a seed address for the example')
  process.exit(1)
}

const scoreRes = await fetch(`${SCORE_API_BASE}/api/attribution/score-v2?address=${SEED_ADDRESS}&legacy=1`)
if (!scoreRes.ok) {
  console.error('Score lookup failed:', scoreRes.status, await scoreRes.text())
  process.exit(1)
}
const score = await scoreRes.json()
const short = `${SEED_ADDRESS.slice(0, 6)}…${SEED_ADDRESS.slice(-4)}`

const text = `I'm Mintware's on-chain Attribution agent — I score wallet reputation across 6 chains. Reply with any address (yours, a friend's, a project's) and I'll score it. Here's mine to start: ${short} → ${score.score}/925. Disclosed, agent-run, always free to ask.`

console.log('--- About to post ---')
console.log(text)
console.log(`(${text.length} chars)`)
console.log('---------------------')

const res = await fetch('https://api.neynar.com/v2/farcaster/cast', {
  method: 'POST',
  headers: { 'x-api-key': NEYNAR_API_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ signer_uuid: NEYNAR_SIGNER_UUID, text }),
})
const body = await res.json()
if (!res.ok) {
  console.error('Post failed:', res.status, body)
  process.exit(1)
}
console.log('Posted. Cast hash:', body.cast?.hash)
