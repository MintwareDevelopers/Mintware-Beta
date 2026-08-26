// Registers the Neynar webhook that fires when @mintware-agent (FID 3347814) is mentioned.
// Run once, post-deploy (needs a real public URL — won't work against localhost).
//
//   node --env-file=.env.local scripts/register-farcaster-webhook.mjs https://mintware.finance
//
// Prints the webhook's id + secret — the secret must be set as NEYNAR_WEBHOOK_SECRET in Vercel
// (it is NOT the same value as NEYNAR_API_KEY). Safe to re-run; Neynar dedupes by name.

const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY
const MINTWARE_AGENT_FID = 3347814

const baseUrl = process.argv[2]
if (!baseUrl) {
  console.error('Usage: node --env-file=.env.local scripts/register-farcaster-webhook.mjs <base-url>')
  process.exit(1)
}
if (!NEYNAR_API_KEY) {
  console.error('NEYNAR_API_KEY not set')
  process.exit(1)
}

const res = await fetch('https://api.neynar.com/v2/farcaster/webhook', {
  method: 'POST',
  headers: { 'x-api-key': NEYNAR_API_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'mintware-agent-mentions',
    url: `${baseUrl.replace(/\/$/, '')}/api/farcaster/mention`,
    subscription: { 'cast.created': { mentioned_fids: [MINTWARE_AGENT_FID] } },
  }),
})

const body = await res.json()
if (!res.ok) {
  console.error('Webhook registration failed:', res.status, body)
  process.exit(1)
}

console.log('Webhook registered.')
console.log('  id:    ', body.webhook?.webhook_id ?? body.webhook_id)
console.log('  secret:', body.webhook?.secrets?.[0]?.value ?? body.secrets?.[0]?.value ?? '(check dashboard)')
console.log('\nSet the secret above as NEYNAR_WEBHOOK_SECRET in Vercel — it is distinct from NEYNAR_API_KEY.')
