import { registerWithMintwareOracle, claimPendingActions, getScore, isRegistered } from '../sdk/dist/index.js'

const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY
const AGENT_ADDRESS     = process.env.AGENT_ADDRESS
const API_BASE          = 'https://mintware.finance'

async function main() {
  console.log('\n🤖 Mintware Demo Agent — Full Flow')
  console.log('━'.repeat(50))
  console.log('Address:', AGENT_ADDRESS)
  console.log('━'.repeat(50) + '\n')

  // Step 1: Check registration
  console.log('Step 1 — Checking registration...')
  const registered = await isRegistered(AGENT_ADDRESS)
  console.log('  Registered:', registered)

  if (!registered) {
    console.log('\nStep 2 — Registering on-chain + syncing profile...')
    const { address, txHash, metadata_url } = await registerWithMintwareOracle({
      privateKey:        AGENT_PRIVATE_KEY,
      apiBase:           API_BASE,
      agentName:         'Mintware Demo Agent',
      agentDescription:  'First agent scored on Mintware Attribution.',
      operationalStatus: 'active',
      x402Support:       false,
    })
    console.log('  ✅ Registered!')
    console.log('  Tx:          ', txHash)
    console.log('  Metadata:    ', metadata_url)
  } else {
    console.log('  ✅ Already registered')
  }

  // Step 3: Pending actions
  console.log('\nStep 3 — Checking pending oracle actions...')
  const res = await fetch(`${API_BASE}/api/agents/${AGENT_ADDRESS}/pending`)
  const pending = await res.json()
  const count = pending?.pending_actions?.length ?? 0
  console.log(`  Pending: ${count}`)

  // Step 4: Claim
  console.log('\nStep 4 — Claiming actions...')
  try {
    const result = await claimPendingActions({ agent: AGENT_ADDRESS, privateKey: AGENT_PRIVATE_KEY, apiBase: API_BASE })
    console.log('  ✅ Submitted:', result.submitted)
    result.hashes?.forEach(h => console.log('  Tx:', h))
  } catch (e) {
    console.log('  Nothing to claim yet (oracle signs within 60s of on-chain activity)')
  }

  // Step 5: Score
  console.log('\nStep 5 — Reading score...')
  try {
    const score = await getScore(AGENT_ADDRESS)
    console.log('  Total score:      ', score.total.toString())
    console.log('  Behavior:         ', score.behavior.toString())
    console.log('  Contribution:     ', score.contribution.toString())
    console.log('  Interpretability: ', score.interpretability.toString())
  } catch (e) {
    console.log('  Score not yet on-chain (needs first claim tx)')
  }

  console.log('\n' + '━'.repeat(50))
  console.log('✅ Done!')
  console.log(`🔗 https://mintware.finance/agent/${AGENT_ADDRESS}`)
  console.log('━'.repeat(50) + '\n')
}

main().catch(console.error)
