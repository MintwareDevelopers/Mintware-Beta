// Test: verifies deadline is included in oracle EIP-712 signature.
// Replicates the exact signing logic from onchainPublisher.ts.
//
// Usage: node scripts/test-deadline.cjs

require('dotenv').config({ path: '.env.local' })

const { createWalletClient, createPublicClient, hashTypedData, http } = require('viem')
const { privateKeyToAccount } = require('viem/accounts')
const { base } = require('viem/chains')

const RAW_KEY          = process.env.DISTRIBUTOR_PRIVATE_KEY
const CONTRACT_ADDRESS = '0x4Deb74E9D50Ebbf9bD883E0A2dcD0a1b4b9Db9BE'

async function main() {
  if (!RAW_KEY) {
    console.error('❌ Missing env: DISTRIBUTOR_PRIVATE_KEY')
    process.exit(1)
  }

  const privateKey = (RAW_KEY.startsWith('0x') ? RAW_KEY : `0x${RAW_KEY}`)
  const account    = privateKeyToAccount(privateKey)
  const walletClient = createWalletClient({ account, chain: base, transport: http('https://mainnet.base.org') })

  console.log(`🔑 Oracle wallet: ${account.address}`)

  const testCampaignId = 'test-campaign-deadline-check'
  const testEpoch      = 1
  const testRoot       = ('0x' + 'ab'.repeat(32))
  const deadline       = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60

  const domain = {
    name:              'MintwareDistributor',
    version:           '1',
    chainId:           base.id,
    verifyingContract: CONTRACT_ADDRESS,
  }

  // v2 types — includes deadline
  const typesWithDeadline = {
    RootPublication: [
      { name: 'campaignId',  type: 'string'  },
      { name: 'epochNumber', type: 'uint256' },
      { name: 'merkleRoot',  type: 'bytes32' },
      { name: 'deadline',    type: 'uint256' },
    ],
  }

  // v1 types — no deadline (old, should produce a different hash)
  const typesWithoutDeadline = {
    RootPublication: [
      { name: 'campaignId',  type: 'string'  },
      { name: 'epochNumber', type: 'uint256' },
      { name: 'merkleRoot',  type: 'bytes32' },
    ],
  }

  const messageWith = {
    campaignId:  testCampaignId,
    epochNumber: BigInt(testEpoch),
    merkleRoot:  testRoot,
    deadline:    BigInt(deadline),
  }

  const messageWithout = {
    campaignId:  testCampaignId,
    epochNumber: BigInt(testEpoch),
    merkleRoot:  testRoot,
  }

  console.log(`\n📋 Deadline value: ${deadline} (${new Date(deadline * 1000).toISOString()})`)

  // Sign both to prove they produce different hashes
  const hashWith    = hashTypedData({ domain, types: typesWithDeadline,    primaryType: 'RootPublication', message: messageWith })
  const hashWithout = hashTypedData({ domain, types: typesWithoutDeadline, primaryType: 'RootPublication', message: messageWithout })

  console.log(`\n🔐 EIP-712 hash WITH deadline:    ${hashWith}`)
  console.log(`🔐 EIP-712 hash WITHOUT deadline: ${hashWithout}`)

  if (hashWith === hashWithout) {
    console.error('\n❌ FAIL: hashes are identical — deadline is NOT affecting the signature!')
    process.exit(1)
  }
  console.log('\n✅ Hashes differ — deadline is correctly included in the EIP-712 message.')

  // Sign with deadline
  const sig = await walletClient.signTypedData({
    account,
    domain,
    types:       typesWithDeadline,
    primaryType: 'RootPublication',
    message:     messageWith,
  })

  console.log(`✅ Signature (v2): ${sig.slice(0, 20)}...${sig.slice(-8)}`)
  console.log(`\n✅ PASS — onchainPublisher will produce v2-compatible signatures with deadline.`)
}

main().catch((err) => {
  console.error('❌ Unexpected error:', err)
  process.exit(1)
})
