// =============================================================================
// scripts/eas-register-schemas.cjs
//
// One-time script to register all 4 Mintware EAS schemas on a target chain.
// Run once per chain — re-running with the same schema string is a no-op
// (the SchemaRegistry reverts if already registered, so we catch that).
//
// Usage:
//   node scripts/eas-register-schemas.cjs --network base_sepolia
//   node scripts/eas-register-schemas.cjs --network base
//
// Required env vars in .env.local:
//   EAS_ATTESTER_PRIVATE_KEY      — pays gas for schema registration
//   EAS_CONTRACT_ADDRESS          — EAS contract on target chain
//   EAS_SCHEMA_REGISTRY_ADDRESS   — SchemaRegistry contract on target chain
//
// EAS contract addresses (Base mainnet):
//   EAS:            0x4200000000000000000000000000000000000021
//   SchemaRegistry: 0x4200000000000000000000000000000000000020
//
// EAS contract addresses (Base Sepolia):
//   EAS:            0x4200000000000000000000000000000000000021
//   SchemaRegistry: 0x4200000000000000000000000000000000000020
//
// After running:
//   1. Copy the 4 UIDs printed to stdout
//   2. Add to .env.local:
//        NEXT_PUBLIC_EAS_SCHEMA_ATTRIBUTION_SCORE=0x...
//        NEXT_PUBLIC_EAS_SCHEMA_SWAP_ACTIVITY=0x...
//        NEXT_PUBLIC_EAS_SCHEMA_REFERRAL_LINK=0x...
//        NEXT_PUBLIC_EAS_SCHEMA_CAMPAIGN_REWARD=0x...
//   3. Add to Vercel environment variables
//   4. UIDs are also saved to deployments/eas-schemas-{network}.json
// =============================================================================

'use strict'

const { SchemaRegistry } = require('@ethereum-attestation-service/eas-sdk')
const { ethers }         = require('ethers')
const fs                 = require('fs')
const path               = require('path')
const dotenv             = require('dotenv')

// Load .env.local (same pattern as deploy.cjs)
dotenv.config({ path: path.join(__dirname, '..', '.env.local') })

// ── CLI args ─────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2)
const netFlag = args.indexOf('--network')
const network = netFlag >= 0 ? args[netFlag + 1] : 'base_sepolia'

const NETWORKS = {
  base_sepolia: {
    rpc:     'https://sepolia.base.org',
    chainId: 84532,
    name:    'Base Sepolia',
  },
  base: {
    rpc:     'https://mainnet.base.org',
    chainId: 8453,
    name:    'Base Mainnet',
  },
}

if (!NETWORKS[network]) {
  console.error(`Unknown network: ${network}. Use "base_sepolia" or "base".`)
  process.exit(1)
}

// ── Env validation ────────────────────────────────────────────────────────────
const ATTESTER_KEY    = process.env.EAS_ATTESTER_PRIVATE_KEY
const REGISTRY_ADDR   = process.env.EAS_SCHEMA_REGISTRY_ADDRESS

if (!ATTESTER_KEY) {
  console.error('Missing EAS_ATTESTER_PRIVATE_KEY in .env.local')
  process.exit(1)
}
if (!REGISTRY_ADDR) {
  console.error('Missing EAS_SCHEMA_REGISTRY_ADDRESS in .env.local')
  process.exit(1)
}

// ── Schema definitions ────────────────────────────────────────────────────────
const SCHEMAS = [
  {
    name:      'AttributionScore',
    schema:    'uint256 score,uint16 maxScore,uint8 percentile,string tier,uint8 scoreVolume,uint8 scoreTrading,uint8 scoreHolding,uint8 scoreLiquidity,uint8 scoreGovernance,uint16 scoreSharing,uint16 treeSize,uint16 treeQualityBps,uint8 chains,uint32 totalTxCount,string character,bytes32 dataHash,uint64 scoredAt,uint8 schemaVersion',
    revocable: true,
    resolver:  ethers.ZeroAddress,
    envKey:    'NEXT_PUBLIC_EAS_SCHEMA_ATTRIBUTION_SCORE',
  },
  {
    name:      'SwapActivity',
    schema:    'bytes32 txHash,uint32 fromChain,uint32 toChain,address fromToken,address toToken,uint256 amountIn,bool feeVerified,string campaignId,uint64 swappedAt,uint8 schemaVersion',
    revocable: false,
    resolver:  ethers.ZeroAddress,
    envKey:    'NEXT_PUBLIC_EAS_SCHEMA_SWAP_ACTIVITY',
  },
  {
    name:      'ReferralLink',
    schema:    'address referrer,string refCode,uint64 linkedAt,uint8 schemaVersion',
    revocable: false,
    resolver:  ethers.ZeroAddress,
    envKey:    'NEXT_PUBLIC_EAS_SCHEMA_REFERRAL_LINK',
  },
  {
    name:      'CampaignReward',
    schema:    'string campaignId,uint32 epochNumber,uint256 amountClaimed,address tokenContract,bytes32 claimTxHash,uint64 claimedAt,uint8 schemaVersion',
    revocable: false,
    resolver:  ethers.ZeroAddress,
    envKey:    'NEXT_PUBLIC_EAS_SCHEMA_CAMPAIGN_REWARD',
  },
]

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const net      = NETWORKS[network]
  const provider = new ethers.JsonRpcProvider(net.rpc)
  const signer   = new ethers.Wallet(ATTESTER_KEY, provider)

  console.log(`\n🔗 EAS Schema Registration`)
  console.log(`   Network: ${net.name} (chainId ${net.chainId})`)
  console.log(`   Attester: ${signer.address}`)
  console.log(`   Registry: ${REGISTRY_ADDR}`)
  console.log()

  const registry = new SchemaRegistry(REGISTRY_ADDR)
  registry.connect(signer)

  const results = {}

  for (const def of SCHEMAS) {
    process.stdout.write(`📋 Registering ${def.name}... `)

    try {
      const tx = await registry.register({
        schema:    def.schema,
        resolverAddress: def.resolver,
        revocable: def.revocable,
      })

      const receipt = await tx.wait()
      // SchemaRegistered event emits the UID
      // The UID is keccak256(abi.encodePacked(schema, resolver, revocable)) — also in receipt
      // Easiest: compute it directly (mirrors the contract's _getUID function)
      const uid = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['string', 'address', 'bool'],
          [def.schema, def.resolver, def.revocable]
        )
      )

      console.log(`✅ ${uid}`)
      console.log(`   tx: ${receipt?.hash ?? 'unknown'}`)
      results[def.name] = uid
    } catch (err) {
      const msg = err?.message ?? String(err)
      if (msg.includes('AlreadyExists') || msg.includes('already registered')) {
        // Schema already on-chain — compute the UID deterministically
        const uid = ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ['string', 'address', 'bool'],
            [def.schema, def.resolver, def.revocable]
          )
        )
        console.log(`⏩ already registered — ${uid}`)
        results[def.name] = uid
      } else {
        console.log(`❌ FAILED: ${msg}`)
        results[def.name] = null
      }
    }
  }

  // ── Print .env.local block ────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────────────────────────────')
  console.log('Add to .env.local and Vercel:\n')
  for (const def of SCHEMAS) {
    const uid = results[def.name]
    if (uid) {
      console.log(`${def.envKey}=${uid}`)
    }
  }
  console.log()

  // ── Save deployments file ─────────────────────────────────────────────────
  const outDir  = path.join(__dirname, '..', 'deployments')
  const outFile = path.join(outDir, `eas-schemas-${network}.json`)
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

  const output = {
    network,
    chainId:  net.chainId,
    attester: signer.address,
    registry: REGISTRY_ADDR,
    schemas:  Object.fromEntries(
      SCHEMAS.map(def => [
        def.name,
        { uid: results[def.name], revocable: def.revocable, schema: def.schema }
      ])
    ),
    timestamp: new Date().toISOString(),
  }

  fs.writeFileSync(outFile, JSON.stringify(output, null, 2))
  console.log(`💾 Saved to ${outFile}`)
  console.log('─────────────────────────────────────────────────────────────\n')
}

main().catch(err => {
  console.error('\n❌ Fatal:', err)
  process.exit(1)
})
