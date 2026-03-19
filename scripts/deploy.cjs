// =============================================================================
// scripts/deploy.cjs
//
// Deploy MintwareDistributor to a target chain and auto-verify on block explorer.
//
// Constructor: MintwareDistributor(owner, oracleSigner)
//   owner        — can pause, rotate oracle, set end dates, sweep unclaimed tokens
//   oracleSigner — the DISTRIBUTOR_PRIVATE_KEY wallet that signs Merkle roots
//                  No treasury arg — fees are off-chain, treasury claims via claim()
//
// Usage:
//   TS_NODE_PROJECT=tsconfig.hardhat.json npx hardhat run scripts/deploy.cjs \
//     --network base_sepolia --config hardhat.config.cts
//
//   TS_NODE_PROJECT=tsconfig.hardhat.json npx hardhat run scripts/deploy.cjs \
//     --network base --config hardhat.config.cts
//
//   Supported networks: base_sepolia, base, core_dao, bnb
//
// Required env vars (.env.local):
//   DEPLOYER_PRIVATE_KEY    — 64 hex chars (no 0x prefix); funds the deployment gas
//   ORACLE_SIGNER_ADDRESS   — address corresponding to DISTRIBUTOR_PRIVATE_KEY
//                             (the key onchainPublisher.ts uses to sign Merkle roots)
//
// Optional env vars (.env.local):
//   OWNER_ADDRESS           — contract owner; defaults to deployer if unset
//
// Block explorer API keys (.env.local):
//   BASESCAN_API_KEY        — base / base_sepolia
//   CORESCAN_API_KEY        — core_dao
//   BSCSCAN_API_KEY         — bnb
//
// After deployment:
//   1. Set DISTRIBUTOR_PRIVATE_KEY in .env.local (matches ORACLE_SIGNER_ADDRESS)
//   2. Update campaigns.contract_address in Supabase for the relevant campaign
//   3. Team deposits tokens: depositCampaign(campaignId, tokenAddress, amount)
//   4. Epoch cron signs roots (zero gas) → users claim when ready
// =============================================================================

'use strict'

const { ethers, run, network } = require('hardhat')
const fs   = require('fs')
const path = require('path')

async function main() {
  const [deployer] = await ethers.getSigners()

  const ownerAddress  = process.env.OWNER_ADDRESS || deployer.address
  const oracleAddress = process.env.ORACLE_SIGNER_ADDRESS

  // ── Validate oracle signer ────────────────────────────────────────────────
  if (!oracleAddress) {
    throw new Error(
      'ORACLE_SIGNER_ADDRESS is not set.\n' +
      'Set it to the address derived from your DISTRIBUTOR_PRIVATE_KEY:\n' +
      '  node -e "const {privateKeyToAccount} = require(\'viem/accounts\'); ' +
      'console.log(privateKeyToAccount(\'0x\' + process.env.DISTRIBUTOR_PRIVATE_KEY).address)"'
    )
  }

  if (!ethers.isAddress(oracleAddress)) {
    throw new Error(`ORACLE_SIGNER_ADDRESS is not a valid address: ${oracleAddress}`)
  }

  console.log('='.repeat(60))
  console.log('MintwareDistributor — Deploy Script')
  console.log('='.repeat(60))
  console.log(`Network:        ${network.name} (chainId: ${network.config.chainId})`)
  console.log(`Deployer:       ${deployer.address}`)
  console.log(`Owner:          ${ownerAddress}`)
  console.log(`Oracle signer:  ${oracleAddress}`)

  const balance = await ethers.provider.getBalance(deployer.address)
  console.log(`Balance:        ${ethers.formatEther(balance)} ETH\n`)

  if (balance === 0n) {
    throw new Error('Deployer has 0 balance — fund the deployer address before deploying')
  }

  // ── Deploy ────────────────────────────────────────────────────────────────
  console.log('Deploying MintwareDistributor...')
  const Distributor = await ethers.getContractFactory('MintwareDistributor')

  // Constructor: (initialOwner, initialOracleSigner)
  const distributor = await Distributor.deploy(ownerAddress, oracleAddress)
  await distributor.waitForDeployment()

  const contractAddress = await distributor.getAddress()
  const deployTx        = distributor.deploymentTransaction()

  console.log(`✓ Deployed to:  ${contractAddress}`)
  console.log(`  TX hash:      ${deployTx ? deployTx.hash : 'n/a'}`)

  // Wait for confirmations before verifying
  const CONFIRMATIONS = network.name === 'hardhat' || network.name === 'localhost' ? 0 : 5
  if (CONFIRMATIONS > 0 && deployTx) {
    console.log(`\nWaiting for ${CONFIRMATIONS} confirmations...`)
    await deployTx.wait(CONFIRMATIONS)
    console.log('✓ Confirmed')
  }

  // ── Save deployment record ────────────────────────────────────────────────
  const summary = {
    network:         network.name,
    chainId:         network.config.chainId,
    contractAddress,
    owner:           ownerAddress,
    oracleSigner:    oracleAddress,
    deployer:        deployer.address,
    txHash:          deployTx ? deployTx.hash : null,
    deployedAt:      new Date().toISOString(),
  }

  const deploymentsDir = path.resolve(__dirname, '../deployments')
  fs.mkdirSync(deploymentsDir, { recursive: true })
  const outFile = path.join(deploymentsDir, `${network.name}.json`)
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2) + '\n')

  console.log('\n' + JSON.stringify(summary, null, 2))
  console.log(`\nRecord saved → deployments/${network.name}.json`)

  // ── Verify on block explorer ──────────────────────────────────────────────
  if (network.name === 'hardhat' || network.name === 'localhost') {
    console.log('\nSkipping verification — not applicable for local network')
    return printNextSteps(contractAddress, network.name, oracleAddress)
  }

  console.log('\nVerifying on block explorer...')
  try {
    await run('verify:verify', {
      address:              contractAddress,
      constructorArguments: [ownerAddress, oracleAddress],
    })
    console.log(`✓ Verified: ${getExplorerUrl(network.name, contractAddress)}`)
  } catch (err) {
    if (err && err.message && err.message.includes('Already Verified')) {
      console.log('✓ Already verified')
    } else {
      console.warn('⚠ Verification failed:', err && err.message ? err.message : err)
      console.log('  Retry manually:')
      console.log(`  npx hardhat verify --network ${network.name} --config hardhat.config.cts \\`)
      console.log(`    ${contractAddress} "${ownerAddress}" "${oracleAddress}"`)
    }
  }

  printNextSteps(contractAddress, network.name, oracleAddress)
}

function getExplorerUrl(networkName, address) {
  const map = {
    base_sepolia: `https://sepolia.basescan.org/address/${address}`,
    base:         `https://basescan.org/address/${address}`,
    core_dao:     `https://scan.coredao.org/address/${address}`,
    bnb:          `https://bscscan.com/address/${address}`,
  }
  return map[networkName] || `(explorer unknown for ${networkName})`
}

function printNextSteps(address, networkName, oracleAddress) {
  console.log('\n' + '='.repeat(60))
  console.log('Next steps:')
  console.log(`  1. Add to .env.local:`)
  console.log(`       DISTRIBUTOR_PRIVATE_KEY=<private key matching ${oracleAddress}>`)
  console.log(`  2. Update campaigns.contract_address in Supabase:`)
  console.log(`       contract_address = '${address}'`)
  console.log(`       chain = '${networkName}'`)
  console.log(`  3. Team calls depositCampaign() to fund the campaign`)
  console.log(`  4. Epoch cron signs roots off-chain (zero gas)`)
  console.log(`  5. Users claim via ClaimCard → they pay gas`)
  console.log('='.repeat(60))
}

main().catch((err) => {
  console.error('\n✗ Deployment failed:', err)
  process.exit(1)
})
