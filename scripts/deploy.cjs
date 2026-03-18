// =============================================================================
// scripts/deploy.cjs
//
// Deploy MintwareDistributor to a target chain and auto-verify on block explorer.
//
// Usage:
//   npx hardhat run scripts/deploy.cjs --network base_sepolia --config hardhat.config.cjs
//   npx hardhat run scripts/deploy.cjs --network base         --config hardhat.config.cjs
//   npx hardhat run scripts/deploy.cjs --network core_dao     --config hardhat.config.cjs
//   npx hardhat run scripts/deploy.cjs --network bnb          --config hardhat.config.cjs
//
// Required env vars (in .env.local):
//   DEPLOYER_PRIVATE_KEY   — 64 hex chars, no 0x prefix
//   OWNER_ADDRESS          — contract owner; defaults to deployer if unset
//
// Block explorer API keys (in .env.local):
//   BASESCAN_API_KEY       — for base / base_sepolia
//   CORESCAN_API_KEY       — for core_dao
//   BSCSCAN_API_KEY        — for bnb
//
// After deployment, update .env.local:
//   NEXT_PUBLIC_MW_TREASURY_ADDRESS=<deployed address>
//   Also update campaigns.contract_address in Supabase for the relevant campaign.
// =============================================================================

'use strict'

const { ethers, run, network } = require('hardhat')
const fs = require('fs')
const path = require('path')

async function main() {
  const [deployer] = await ethers.getSigners()

  const ownerAddress = process.env.OWNER_ADDRESS || deployer.address

  console.log('='.repeat(60))
  console.log('MintwareDistributor — Deploy Script')
  console.log('='.repeat(60))
  console.log(`Network:    ${network.name} (chainId: ${network.config.chainId})`)
  console.log(`Deployer:   ${deployer.address}`)
  console.log(`Owner:      ${ownerAddress}`)

  const balance = await ethers.provider.getBalance(deployer.address)
  console.log(`Balance:    ${ethers.formatEther(balance)} ETH\n`)

  if (balance === 0n) {
    throw new Error('Deployer has 0 balance — fund the deployer address before deploying')
  }

  // ---------------------------------------------------------------------------
  // Deploy
  // ---------------------------------------------------------------------------
  console.log('Deploying MintwareDistributor...')
  const Distributor = await ethers.getContractFactory('MintwareDistributor')
  const distributor = await Distributor.deploy(ownerAddress)
  await distributor.waitForDeployment()

  const contractAddress = await distributor.getAddress()
  const deployTx = distributor.deploymentTransaction()

  console.log(`✓ Deployed to: ${contractAddress}`)
  console.log(`  TX hash:     ${deployTx ? deployTx.hash : 'n/a'}`)

  // Wait for confirmations before verifying
  const CONFIRMATIONS = network.name === 'hardhat' ? 0 : 5
  if (CONFIRMATIONS > 0) {
    console.log(`\nWaiting for ${CONFIRMATIONS} confirmations...`)
    await deployTx.wait(CONFIRMATIONS)
    console.log('✓ Confirmed')
  }

  // ---------------------------------------------------------------------------
  // Save deployment record
  // ---------------------------------------------------------------------------
  const summary = {
    network: network.name,
    chainId: network.config.chainId,
    contractAddress,
    owner: ownerAddress,
    deployer: deployer.address,
    txHash: deployTx ? deployTx.hash : null,
    deployedAt: new Date().toISOString(),
  }

  const deploymentsDir = path.resolve(__dirname, '../deployments')
  fs.mkdirSync(deploymentsDir, { recursive: true })
  const outFile = path.join(deploymentsDir, `${network.name}.json`)
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2) + '\n')

  console.log('\n' + JSON.stringify(summary, null, 2))
  console.log(`\nRecord saved → deployments/${network.name}.json`)

  // ---------------------------------------------------------------------------
  // Verify on block explorer
  // ---------------------------------------------------------------------------
  if (network.name === 'hardhat' || network.name === 'localhost') {
    console.log('\nSkipping verification — not applicable for local network')
    return printNextSteps(contractAddress, network.name)
  }

  console.log('\nVerifying on block explorer...')
  try {
    await run('verify:verify', {
      address: contractAddress,
      constructorArguments: [ownerAddress],
    })
    console.log(`✓ Verified: ${getExplorerUrl(network.name, contractAddress)}`)
  } catch (err) {
    if (err && err.message && err.message.includes('Already Verified')) {
      console.log('✓ Already verified')
    } else {
      console.warn('⚠ Verification failed:', err && err.message ? err.message : err)
      console.log('  Retry manually:')
      console.log(`  npx hardhat verify --network ${network.name} --config hardhat.config.cjs \\`)
      console.log(`    ${contractAddress} "${ownerAddress}"`)
    }
  }

  printNextSteps(contractAddress, network.name)
}

function getExplorerUrl(networkName, address) {
  const map = {
    base_sepolia: `https://sepolia.basescan.org/address/${address}`,
    base: `https://basescan.org/address/${address}`,
    core_dao: `https://scan.coredao.org/address/${address}`,
    bnb: `https://bscscan.com/address/${address}`,
  }
  return map[networkName] || `(explorer unknown for ${networkName})`
}

function printNextSteps(address, networkName) {
  console.log('\n' + '='.repeat(60))
  console.log('Next steps:')
  console.log(`  1. Add to .env.local:`)
  console.log(`       NEXT_PUBLIC_MW_TREASURY_ADDRESS=${address}`)
  console.log(`  2. Set campaigns.contract_address in Supabase for your campaign`)
  console.log(`  3. Fund the owner wallet to call createDistribution()`)
  console.log(`  4. Wire Ticket 6 claim API: POST /api/claim`)
  console.log('='.repeat(60))
}

main().catch((err) => {
  console.error('\n✗ Deployment failed:', err)
  process.exit(1)
})
