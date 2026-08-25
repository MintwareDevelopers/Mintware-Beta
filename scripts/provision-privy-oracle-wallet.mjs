#!/usr/bin/env node
// Provision a Privy SERVER WALLET for the Mintware oracle/settle signer seat.
//
// Run this yourself — it reads PRIVY_APP_ID + PRIVY_APP_SECRET from YOUR env and prints back only the
// PUBLIC walletId + address. The app secret never leaves your machine. The created wallet's key lives in
// Privy's enclave (no raw private key anywhere), which is the whole point of ORACLE_SIGNER_PROVIDER=privy.
//
// Usage (from the repo root):
//   pnpm add @privy-io/server-auth        # if not already installed
//   PRIVY_APP_ID=... PRIVY_APP_SECRET=... node scripts/provision-privy-oracle-wallet.mjs
//
// Then set the printed values in Vercel + .env.local:
//   ORACLE_SIGNER_PROVIDER=privy
//   ROOT_ORACLE_PRIVY_WALLET_ID=<id>
//   ROOT_ORACLE_PRIVY_ADDRESS=<address>
// and, to collect x402 fees in this same wallet:
//   X402_PAY_TO=<address>
// Finally grant the on-chain role so it can settle:
//   cast send <GATEWAY> "grantRole(bytes32,address)" $(cast keccak "RELAYER_ROLE") <address> \
//     --rpc-url <RPC> --private-key <GATEWAY_ADMIN_KEY>

const appId = process.env.PRIVY_APP_ID
const appSecret = process.env.PRIVY_APP_SECRET

if (!appId || !appSecret) {
  console.error('✗ Missing creds. Set PRIVY_APP_ID and PRIVY_APP_SECRET in your env and re-run.')
  console.error('  (This script prints only the public walletId + address; your secret is never logged.)')
  process.exit(1)
}

let PrivyClient
try {
  ;({ PrivyClient } = await import('@privy-io/server-auth'))
} catch {
  console.error('✗ @privy-io/server-auth is not installed. Run:  pnpm add @privy-io/server-auth')
  process.exit(1)
}

const privy = new PrivyClient(appId, appSecret)

// The wallet-create surface has been `walletApi.create` across recent versions; fall back to `createWallet`
// on older/newer shapes so this keeps working if the method name shifts.
async function createEthereumServerWallet() {
  const api = privy.walletApi ?? privy
  if (typeof api.create === 'function') return api.create({ chainType: 'ethereum' })
  if (typeof api.createWallet === 'function') return api.createWallet({ chainType: 'ethereum' })
  if (typeof privy.createWallet === 'function') return privy.createWallet({ chainType: 'ethereum' })
  throw new Error('could not find a wallet-create method on PrivyClient (checked walletApi.create / createWallet)')
}

try {
  const w = await createEthereumServerWallet()
  const id = w.id ?? w.walletId
  const address = w.address
  if (!id || !address) throw new Error(`unexpected response shape: ${JSON.stringify(w)}`)

  console.log('\n✓ Privy server wallet created.\n')
  console.log('  ROOT_ORACLE_PRIVY_WALLET_ID =', id)
  console.log('  ROOT_ORACLE_PRIVY_ADDRESS   =', address)
  console.log('\nNext:')
  console.log('  1. Set the two vars above + ORACLE_SIGNER_PROVIDER=privy in Vercel (+ .env.local).')
  console.log('  2. To collect x402 fees here too:  X402_PAY_TO =', address)
  console.log('  3. Grant RELAYER_ROLE to', address, 'on the gateway (see this file’s header).')
  console.log('  4. Fund it with a little gas on the settle chain.\n')
} catch (e) {
  console.error('✗ Wallet creation failed:', e instanceof Error ? e.message : e)
  console.error('  Check that your Privy app has Server Wallets enabled and the app id/secret match it.')
  process.exit(1)
}
