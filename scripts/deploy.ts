// =============================================================================
// scripts/deploy.ts
//
// Deploy MintwareDistributor to a target chain and auto-verify on block explorer.
//
// Usage:
//   npx hardhat run scripts/deploy.ts --network base_sepolia --config hardhat.config.ts
//   npx hardhat run scripts/deploy.ts --network base         --config hardhat.config.ts
//   npx hardhat run scripts/deploy.ts --network core_dao     --config hardhat.config.ts
//   npx hardhat run scripts/deploy.ts --network bnb          --config hardhat.config.ts
//
// Required env vars:
//   DEPLOYER_PRIVATE_KEY    — set in .env.local (no 0x prefix)
//   OWNER_ADDRESS           — the address to set as contract owner (usually deployer)
//                             if unset, defaults to deployer address
//
// Block explorer verification:
//   BASESCAN_API_KEY        — for base / base_sepolia
//   CORESCAN_API_KEY        — for core_dao
//   BSCSCAN_API_KEY         — for bnb
//
// After deployment, update .env.local:
//   NEXT_PUBLIC_MW_TREASURY_ADDRESS=<deployed address>   (or chain-specific var)
//   campaigns.contract_address in Supabase for the relevant campaign
// =============================================================================

import { ethers, run, network } from 'hardhat'
import * as fs from 'fs'
import * as path from 'path'

async function main() {
  const [deployer] = await ethers.getSigners()

  // Determine owner address — defaults to deployer
  const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address

  console.log('='.repeat(60))
  console.log('MintwareDistributor — Deploy Script')
  console.log('='.repeat(60))
  console.log(`Network:    ${network.name} (chainId: ${network.config.chainId})`)
  console.log(`Deployer:   ${deployer.address}`)
  console.log(`Owner:      ${ownerAddress}`)
  console.log()

  // Confirm deployer balance
  const balance = await ethers.provider.getBalance(deployer.address)
  console.log(`Deployer balance: ${ethers.formatEther(balance)} ETH`)
  if (balance === 0n) {
    throw new Error('Deployer has 0 balance — fund the deployer address before deploying')
  }

  // ---------------------------------------------------------------------------
  // Deploy
  // ---------------------------------------------------------------------------
  console.log('\nDeploying MintwareDistributor...')

  const Distributor = await ethers.getContractFactory('MintwareDistributor')
  const distributor = await Distributor.deploy(ownerAddress)
  await distributor.waitForDeployment()

  const contractAddress = await distributor.getAddress()
  const deployTx = distributor.deploymentTransaction()

  console.log(`✓ MintwareDistributor deployed to: ${contractAddress}`)
  console.log(`  TX hash: ${deployTx?.hash}`)

  // Wait for extra confirmations before verifying (block explorers need time to index)
  const CONFIRMATIONS = network.name === 'hardhat' ? 0 : 5
  if (CONFIRMATIONS > 0) {
    console.log(`\nWaiting for ${CONFIRMATIONS} confirmations before verification...`)
    await deployTx?.wait(CONFIRMATIONS)
    console.log('✓ Confirmations received')
  }

  // ---------------------------------------------------------------------------
  // Log deployment summary
  // ---------------------------------------------------------------------------
  const summary = {
    network: network.name,
    chainId: network.config.chainId,
    contractAddress,
    owner: ownerAddress,
    deployer: deployer.address,
    txHash: deployTx?.hash,
    deployedAt: new Date().toISOString(),
  }

  console.log('\n' + '='.repeat(60))
  console.log('Deployment Summary:')
  console.log(JSON.stringify(summary, null, 2))
  console.log('='.repeat(60))

  // Write deployment record to disk (gitignored by convention — don't commit addresses)
  const deploymentsDir = path.resolve(__dirname, '../deployments')
  fs.mkdirSync(deploymentsDir, { recursive: true })
  const outFile = path.join(deploymentsDir, `${network.name}.json`)
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2) + '\n')
  console.log(`\nDeployment record saved to: deployments/${network.name}.json`)

  // ---------------------------------------------------------------------------
  // Verify on block explorer
  // ---------------------------------------------------------------------------
  if (network.name === 'hardhat' || network.name === 'localhost') {
    console.log('\nSkipping verification — not applicable for local network')
    return
  }

  console.log('\nVerifying on block explorer...')
  try {
    await run('verify:verify', {
      address: contractAddress,
      constructorArguments: [ownerAddress],
    })
    console.log('✓ Contract verified successfully')
    console.log(`  View: ${getExplorerUrl(network.name, contractAddress)}`)
  } catch (err: any) {
    if (err?.message?.includes('Already Verified')) {
      console.log('✓ Contract already verified')
    } else {
      console.warn('⚠ Verification failed:', err?.message ?? err)
      console.log('  Retry manually:')
      console.log(
        `  npx hardhat verify --network ${network.name} --config hardhat.config.ts \\`
      )
      console.log(`    ${contractAddress} "${ownerAddress}"`)
    }
  }

  // ---------------------------------------------------------------------------
  // Post-deploy instructions
  // ---------------------------------------------------------------------------
  console.log('\n' + '='.repeat(60))
  console.log('Next steps:')
  console.log(`  1. Update .env.local with the deployed address:`)
  console.log(`       NEXT_PUBLIC_MW_TREASURY_ADDRESS=${contractAddress}`)
  console.log(`  2. Set campaigns.contract_address in Supabase for your campaign`)
  console.log(`  3. Fund the owner wallet so it can call createDistribution()`)
  console.log(`  4. Test with Ticket 6 claim API: POST /api/claim`)
  console.log('='.repeat(60))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getExplorerUrl(networkName: string, address: string): string {
  const explorers: Record<string, string> = {
    base_sepolia: `https://sepolia.basescan.org/address/${address}`,
    base: `https://basescan.org/address/${address}`,
    core_dao: `https://scan.coredao.org/address/${address}`,
    bnb: `https://bscscan.com/address/${address}`,
  }
  return explorers[networkName] ?? `(unknown explorer for ${networkName})`
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error('\n✗ Deployment failed:', err)
  process.exit(1)
})
