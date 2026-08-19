// POST /api/oracle/deploy-ypn-v1-testnet   (route group (admin) is stripped from the URL)
//
// One-click TESTNET deploy of the YPN v1 PAYMENT CORE to Base Sepolia, signed by the Privy server
// wallet (getOracleSigner('root')). This is the price-free settlement stack the card rail talks to —
// NOT the ULV (that is deploy-pair-full-testnet). Three contracts + wiring, no V4 / no hook / no libs:
//
//   1. AaveV3YieldAdapter(USDC)  — idle USDC → Aave v3 (the vault's yield source, IYieldAdapter seam)
//   2. MintwareYieldVault        — single-asset USDC ERC-4626-style vault; native IYieldVault impl
//   3. MintwarePaymentGateway    — AccessControl+EIP712 settlement authority (DelegatedSpendPermit +
//                                  ShortLivedHoldAuth); the SOLE caller of vault.burnForPayment
//
// Wiring: adapter.setVault(vault) · vault.setGateway(gateway). The Gateway constructor grants the
// admin (this Privy wallet) DEFAULT_ADMIN + RELAYER + EDGE_SIGNER + PAUSER — the real Rust relayer /
// edge-signer keys are granted later via grantRole; the deployer holding them lets a first smoke
// settlement run end-to-end from one wallet.
//
// ⚠ Fires REAL Base-Sepolia transactions (spends the Privy wallet's testnet ETH). Bearer-gated
// (CRON_SECRET). TESTNET ONLY (Base Sepolia hardcoded). Idempotency: each call deploys a FRESH stack.

import { createPublicClient, createWalletClient, http } from 'viem'
import { baseSepolia } from 'viem/chains'
import { createHandler } from '@/lib/web2/routeHandler'
import { ADMIN_SECRET } from '@/lib/constants'
import { getOracleSigner } from '@/lib/web3/oracleSigner'
import { AAVE_ADAPTER_ABI, AAVE_ADAPTER_BYTECODE } from '@/lib/web3/artifacts/aaveAdapter'
import { YIELD_VAULT_ABI, YIELD_VAULT_BYTECODE } from '@/lib/web3/artifacts/mintwareYieldVault'
import { PAYMENT_GATEWAY_ABI, PAYMENT_GATEWAY_BYTECODE } from '@/lib/web3/artifacts/mintwarePaymentGateway'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// USDC must be the AAVE-MARKET token on Base Sepolia so the adapter ctor's aToken check passes.
const USDC          = '0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f' as const // Aave v3 Base-Sepolia USDC
const AUSDC         = '0x10F1A9D11CDf50041f3f8cB7191CBE2f31750ACC' as const // aToken for USDC
const AAVE_PROVIDER = '0xE4C23309117Aa30342BFaae6c95c6478e0A4Ad00' as const // PoolAddressesProvider
const ZERO          = '0x0000000000000000000000000000000000000000' as const

/** Deploy a contract and poll until its code is visible on the (lagging) public RPC before the next
 *  write simulates against it. Returns the address, or null on revert. */
async function deployAndConfirm(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  publicClient: any, walletClient: any, account: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  abi: any, bytecode: `0x${string}`, args: readonly unknown[],
): Promise<{ tx: `0x${string}`; addr: `0x${string}` | null }> {
  const tx = await walletClient.deployContract({ abi, bytecode, args, account, chain: baseSepolia })
  const rcpt = await publicClient.waitForTransactionReceipt({ hash: tx })
  if (rcpt.status !== 'success' || !rcpt.contractAddress) return { tx, addr: null }
  let code = await publicClient.getBytecode({ address: rcpt.contractAddress })
  for (let i = 0; i < 8 && (!code || code === '0x'); i++) {
    await new Promise((r) => setTimeout(r, 1000))
    code = await publicClient.getBytecode({ address: rcpt.contractAddress })
  }
  return { tx, addr: rcpt.contractAddress }
}

export const POST = createHandler(async (_req, ctx) => {
  const account = await getOracleSigner('root') // the Privy wallet
  const transport = http(process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org')
  const publicClient = createPublicClient({ chain: baseSepolia, transport })
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport })

  if ((await publicClient.getBalance({ address: account.address })) === 0n) {
    return ctx.json({ ok: false, step: 'preflight', deployer: account.address,
      error: `Deployer ${account.address} holds 0 Base Sepolia ETH — fund it, then retry.` }, 400)
  }

  // 1. Aave v3 yield adapter for USDC. Ctor: (provider, asset, aToken, vault=0, owner).
  const adapter = await deployAndConfirm(publicClient, walletClient, account,
    AAVE_ADAPTER_ABI, AAVE_ADAPTER_BYTECODE, [AAVE_PROVIDER, USDC, AUSDC, ZERO, account.address])
  if (!adapter.addr) return ctx.json({ ok: false, step: 'adapter-deploy', adapterDeployTx: adapter.tx, error: 'adapter deploy reverted' }, 500)

  // 2. The single-asset USDC vault. Ctor: (usdc, adapter, owner).
  const vault = await deployAndConfirm(publicClient, walletClient, account,
    YIELD_VAULT_ABI, YIELD_VAULT_BYTECODE, [USDC, adapter.addr, account.address])
  if (!vault.addr) return ctx.json({ ok: false, step: 'vault-deploy', vaultDeployTx: vault.tx, error: 'vault deploy reverted' }, 500)

  // 3. Authorize the vault as the adapter's sole supply/withdraw caller.
  const setVaultTx = await walletClient.writeContract({
    address: adapter.addr, abi: AAVE_ADAPTER_ABI, functionName: 'setVault', args: [vault.addr], account, chain: baseSepolia,
  })
  await publicClient.waitForTransactionReceipt({ hash: setVaultTx })

  // 4. The payment gateway. Ctor: (vault, usdc, treasury, admin). Admin = deployer (gets all roles).
  const gateway = await deployAndConfirm(publicClient, walletClient, account,
    PAYMENT_GATEWAY_ABI, PAYMENT_GATEWAY_BYTECODE, [vault.addr, USDC, account.address, account.address])
  if (!gateway.addr) return ctx.json({ ok: false, step: 'gateway-deploy', gatewayDeployTx: gateway.tx, error: 'gateway deploy reverted' }, 500)

  // 5. Wire the gateway as the vault's sole burnForPayment caller (set-once). Poll for the gateway's
  //    code first so setGateway's gas-estimation doesn't simulate against a node that lacks it yet.
  const setGatewayTx = await walletClient.writeContract({
    address: vault.addr, abi: YIELD_VAULT_ABI, functionName: 'setGateway', args: [gateway.addr], account, chain: baseSepolia,
  })
  await publicClient.waitForTransactionReceipt({ hash: setGatewayTx })

  return ctx.json({
    ok: true,
    chain: 'base_sepolia',
    deployer: account.address,
    adapter: adapter.addr,
    vault: vault.addr,
    gateway: gateway.addr,
    usdc: USDC, aUsdc: AUSDC, aaveProvider: AAVE_PROVIDER,
    roles: { admin: account.address, note: 'deployer holds DEFAULT_ADMIN + RELAYER + EDGE_SIGNER + PAUSER; grant the real Rust relayer/edge keys via grantRole' },
    txs: { adapterDeployTx: adapter.tx, vaultDeployTx: vault.tx, setVaultTx, gatewayDeployTx: gateway.tx, setGatewayTx },
    basescan: {
      vault: `https://sepolia.basescan.org/address/${vault.addr}`,
      gateway: `https://sepolia.basescan.org/address/${gateway.addr}`,
    },
    next: 'Fund the deployer with test USDC, then smoke: vault.deposit(usdc, deployer) → gateway settles a burnForPayment → USDC to a receiver. Set NEXT_PUBLIC_YPN_VAULT_ADDRESS / _GATEWAY_ADDRESS.',
  })
}, { auth: 'bearer-token', bearerSecret: ADMIN_SECRET })
