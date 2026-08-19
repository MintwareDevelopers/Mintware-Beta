// POST /api/oracle/deploy-pair-testnet   (route group (admin) is stripped from the URL)
//
// One-click TESTNET deploy of the DeFi trading leg — MWHookCoordinator (the V4 hook) + a
// MintwareDeFiPairVault (USDC/WETH) — to Base Sepolia, executed FROM the configured oracle signer
// (a Privy server wallet when ORACLE_SIGNER_PROVIDER=privy). A V4 hook's ADDRESS must encode its
// permission bits (0xAC8), so we CREATE2-mine a salt in-process (mirrors HookMiner.find), deploy the
// hook at the mined address via the canonical CREATE2 factory, deploy the vault with the hook baked
// into its PoolKey, wire hook.setVault(vault), and initialize the pool — all signed by the Privy
// wallet. No raw deployer key, no old wallets.
//
// Requires: ORACLE_SIGNER_PROVIDER=privy + the root Privy wallet env, and the wallet funded with a
// little Base Sepolia ETH. Bearer-gated (CRON_SECRET). TESTNET ONLY (Base Sepolia hardcoded).

import {
  createPublicClient, createWalletClient, http,
  encodeAbiParameters, keccak256, concat, toHex, slice, getAddress,
} from 'viem'
import { baseSepolia } from 'viem/chains'
import { createHandler } from '@/lib/web2/routeHandler'
import { ADMIN_SECRET } from '@/lib/constants'
import { getOracleSigner } from '@/lib/web3/oracleSigner'
import { HOOK_COORDINATOR_ABI, HOOK_COORDINATOR_BYTECODE } from '@/lib/web3/artifacts/hookCoordinator'
import { PAIR_VAULT_ABI, PAIR_VAULT_BYTECODE } from '@/lib/web3/artifacts/pairVault'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const POOL_MANAGER = '0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408' as const // Base Sepolia V4 PoolManager
const C2_FACTORY   = '0x4e59b44847b379578588920cA78FbF26c0B4956C' as const // canonical CREATE2 factory
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const
const WETH = '0x4200000000000000000000000000000000000006' as const         // Base WETH9 predeploy
const ZERO = '0x0000000000000000000000000000000000000000' as const
const HOOK_FLAGS = 0xac8n
const HOOK_MASK  = 0x3fffn                                                  // ALL_HOOK_MASK = (1<<14)-1
const MAX_LOOP   = 160_000
const PROFILE_EMERGING = 1                                                  // PoolProfile enum
const FEE = 3000
const TICK_SPACING = 60
const SQRT_PRICE_1_1 = 79228162514264337593543950336n                      // valid init price (tick 0)

/** Mirror HookMiner.find: mine salt so the CREATE2 hook address matches the permission bits. */
function mineHookSalt(initcode: `0x${string}`): { salt: `0x${string}`; hook: `0x${string}` } | null {
  const initcodeHash = keccak256(initcode)
  for (let nonce = 0; nonce < MAX_LOOP; nonce++) {
    const salt = toHex(BigInt(nonce), { size: 32 })
    const addr = getAddress(slice(keccak256(concat(['0xff', C2_FACTORY, salt, initcodeHash])), 12))
    if ((BigInt(addr) & HOOK_MASK) === HOOK_FLAGS) return { salt, hook: addr }
  }
  return null
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

  // Sorted currencies (V4 requires currency0 < currency1).
  const [currency0, currency1] = BigInt(USDC) < BigInt(WETH) ? [USDC, WETH] : [WETH, USDC]

  // 1. Mine + CREATE2-deploy the hook (vault=0 at deploy, wired below).
  const hookArgs = encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'address' }],
    [POOL_MANAGER, ZERO, account.address],
  )
  const initcode = concat([HOOK_COORDINATOR_BYTECODE, hookArgs])
  const mined = mineHookSalt(initcode)
  if (!mined) return ctx.json({ ok: false, step: 'mine', error: 'no hook salt within MAX_LOOP' }, 500)

  // Idempotent: if the hook is already deployed at the mined address (e.g. a prior partial run),
  // reuse it — re-running the CREATE2 deploy would revert (address occupied). Otherwise deploy.
  let hookDeployTx: `0x${string}` | 'reused-existing' = 'reused-existing'
  const preExisting = await publicClient.getBytecode({ address: mined.hook })
  if (!preExisting || preExisting === '0x') {
    hookDeployTx = await walletClient.sendTransaction({
      account, chain: baseSepolia, to: C2_FACTORY, data: concat([mined.salt, initcode]),
    })
    await publicClient.waitForTransactionReceipt({ hash: hookDeployTx })
  }
  // Poll for code — public RPCs lag read-after-write, so a single check can false-negative.
  let hookCode = await publicClient.getBytecode({ address: mined.hook })
  for (let i = 0; i < 8 && (!hookCode || hookCode === '0x'); i++) {
    await new Promise((r) => setTimeout(r, 1000))
    hookCode = await publicClient.getBytecode({ address: mined.hook })
  }
  if (!hookCode || hookCode === '0x') {
    return ctx.json({ ok: false, step: 'hook-deploy', hook: mined.hook, hookDeployTx, error: 'no code at mined hook address after retries' }, 500)
  }

  // 2. Deploy the vault with the hook baked into its PoolKey.
  const poolKey = { currency0, currency1, fee: FEE, tickSpacing: TICK_SPACING, hooks: mined.hook }
  const vaultDeployTx = await walletClient.deployContract({
    abi: PAIR_VAULT_ABI, bytecode: PAIR_VAULT_BYTECODE, account, chain: baseSepolia,
    args: [POOL_MANAGER, poolKey, PROFILE_EMERGING, account.address, account.address, account.address],
  })
  const vaultRcpt = await publicClient.waitForTransactionReceipt({ hash: vaultDeployTx })
  const vault = vaultRcpt.contractAddress
  if (vaultRcpt.status !== 'success' || !vault) {
    return ctx.json({ ok: false, step: 'vault-deploy', vaultDeployTx, error: 'vault deploy reverted' }, 500)
  }

  // 3. Wire the vault into the hook (vault-only LP gate) and initialize the pool.
  const setVaultTx = await walletClient.writeContract({
    address: mined.hook, abi: HOOK_COORDINATOR_ABI, functionName: 'setVault', args: [vault], account, chain: baseSepolia,
  })
  await publicClient.waitForTransactionReceipt({ hash: setVaultTx })

  const initTx = await walletClient.writeContract({
    address: vault, abi: PAIR_VAULT_ABI, functionName: 'initializePool', args: [SQRT_PRICE_1_1], account, chain: baseSepolia,
  })
  await publicClient.waitForTransactionReceipt({ hash: initTx })

  return ctx.json({
    ok: true,
    chain: 'base_sepolia',
    deployer: account.address,
    hook: mined.hook,
    vault,
    poolManager: POOL_MANAGER,
    currency0, currency1, fee: FEE, tickSpacing: TICK_SPACING,
    txs: { hookDeployTx, vaultDeployTx, setVaultTx, initTx },
    basescanHook: `https://sepolia.basescan.org/address/${mined.hook}`,
    basescanVault: `https://sepolia.basescan.org/address/${vault}`,
  })
}, { auth: 'bearer-token', bearerSecret: ADMIN_SECRET })
