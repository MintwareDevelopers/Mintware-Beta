// Posts the launch cast for @mintware-agent — the locked-in "reply to get scored" opener.
// Scores the seed example live (not hardcoded) so the number shown is always current.
//
//   node --env-file=.env.local scripts/post-first-farcaster-cast.mjs
//
// Review the printed text before this actually runs — it posts for real, no dry-run flag.
// Re-running posts a duplicate cast; this is meant to run once.
//
// Seed address note (2026-08-26): originally used NEXT_PUBLIC_MW_TREASURY_ADDRESS, framed as
// "here's mine." Checked it before launch — it's a stale testnet contract, scores 0/925, brand
// new. The other Mintware-controlled candidate (NEXT_PUBLIC_MINTWARE_TREASURY) also scores 0.
// The demo agent deployer (0x9c646C48a302f4725450669f1218d3FDb3e933AD, docs/agents.md) is real
// but thin — 25/925, 2 txs. None of these make a compelling first impression, and "here's mine"
// was a stretch to begin with. Using a well-known public address instead, honestly labeled as an
// example rather than implied as Mintware's own.

// Hits the deployed score API rather than importing lib/attribution/*.ts directly — this is a
// plain Node script (no TS loader registered in this repo's scripts/), and it doubles as a
// smoke test of the real production endpoint rather than reimporting internal logic.
const SCORE_API_BASE = process.env.MINTWARE_APP_URL ?? 'https://mintware.finance'

const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY
const NEYNAR_SIGNER_UUID = process.env.NEYNAR_SIGNER_UUID
// vitalik.eth — well-known, real, genuinely-scored public address. Override with SEED_ADDRESS
// env var if you'd rather use a different example.
const SEED_ADDRESS = process.env.SEED_ADDRESS ?? '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

if (!NEYNAR_API_KEY || !NEYNAR_SIGNER_UUID) {
  console.error('NEYNAR_API_KEY / NEYNAR_SIGNER_UUID not set')
  process.exit(1)
}

const scoreRes = await fetch(`${SCORE_API_BASE}/api/attribution/score-v2?address=${SEED_ADDRESS}&legacy=1`)
if (!scoreRes.ok) {
  console.error('Score lookup failed:', scoreRes.status, await scoreRes.text())
  process.exit(1)
}
const score = await scoreRes.json()
const short = `${SEED_ADDRESS.slice(0, 6)}…${SEED_ADDRESS.slice(-4)}`

const text = `I'm Mintware's on-chain Attribution agent — I score wallet reputation across 6 chains. Reply with any address (yours, a friend's, a project's) and I'll score it. Example: ${short} → ${score.score}/925 (${score.tier}, ${score.percentile}th pct). Disclosed, agent-run, always free to ask.`

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
