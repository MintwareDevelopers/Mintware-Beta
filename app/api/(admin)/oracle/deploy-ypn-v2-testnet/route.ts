// POST /api/oracle/deploy-ypn-v2-testnet   (route group (admin) is stripped from the URL)
//
// One-click TESTNET deploy of the YPN v2 treasury-anchored ULV stack — the "spend-while-you-earn"
// vault + its real V4 JIT hook + the payment gateway — to Base Sepolia, signed by the Privy server
// wallet (getOracleSigner('root')). Mirrors deploy-pair-full-testnet but for the payment stack.
//
// Deploys + fully wires, in one run (matches contracts-v4/script/DeployTreasuryV2.s.sol):
//   • AaveV3YieldAdapter (USDC over Aave v3 Base-Sepolia) — vault authorized after the vault deploys
//   • MintwareTreasuryVault (senior = community USDC, junior = the team token)
//   • MintwareTreasuryJitHook (mined 0xC0 = beforeSwap|afterSwap) — bounded-slice JIT on team→USDC
//   • the V4 pool, opened WITH the hook at a decimal-adjusted price
//   • MintwareV4LiquidityModule behind the ILiquidityModule seam
//   • MintwarePaymentGateway — settles card charges against the senior side
//   • wiring: setLiquidityModule / setJitHook / setJitSkipSender(module) / setGateway / setProtocolTreasury
//
// After this: the TEAM commits its junior via vault.commitTeam(...); point edge-auth at the vault
// (EDGE_VAULT_KIND=v2, EDGE_VAULT_ADDRESS, EDGE_GATEWAY_ADDRESS) + the relayer at the new gateway.
//
// Body (JSON, optional): { teamToken, circleTreasury?, initSqrtPrice?, mockUsdc? }
//   teamToken     — the project token (defaults to WETH predeploy if unset; use an 18-dp test token).
//   circleTreasury — the card rail / protocol treasury (defaults to the Privy wallet).
//   initSqrtPrice — override the pool's start price (else computed for 1 whole team = 1 whole USDC).
//   mockUsdc      — true → deploy a fresh public-mint MockERC20 as USDC + a no-op MockYieldAdapter
//                   (self-contained: the smoke route mints its own test USDC, no faucet/Aave needed).
//
// ⚠ Bearer-gated (CRON_SECRET). TESTNET ONLY (Base Sepolia hardcoded). Requires ORACLE_SIGNER_PROVIDER
//   =privy + a funded wallet. JIT is on by default (jitMaxPerBlockBps=5%); setJitCap(0) disables.

import {
  createPublicClient, createWalletClient, http,
  encodeAbiParameters, keccak256, concat, toHex, slice, getAddress, isAddress,
} from 'viem'
import { baseSepolia } from 'viem/chains'
import { createHandler } from '@/lib/web2/routeHandler'
import { getOracleSigner } from '@/lib/web3/oracleSigner'
import {
  ADAPTER_ABI, ADAPTER_BYTECODE, VAULT_ABI, VAULT_BYTECODE, HOOK_ABI, HOOK_BYTECODE,
  MODULE_ABI, MODULE_BYTECODE, GATEWAY_ABI, GATEWAY_BYTECODE,
  MOCK_ERC20_ABI, MOCK_ERC20_BYTECODE, MOCK_ADAPTER_ABI, MOCK_ADAPTER_BYTECODE,
} from '@/lib/web3/artifacts/treasuryV2'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const POOL_MANAGER  = '0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408' as const // Base Sepolia V4 PoolManager
const C2_FACTORY    = '0x4e59b44847b379578588920cA78FbF26c0B4956C' as const // canonical CREATE2 factory
const USDC          = '0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f' as const // Aave v3 Base-Sepolia USDC (6dp)
const AUSDC         = '0x10F1A9D11CDf50041f3f8cB7191CBE2f31750ACC' as const // aToken for USDC
const AAVE_PROVIDER = '0xE4C23309117Aa30342BFaae6c95c6478e0A4Ad00' as const // Aave PoolAddressesProvider
const WETH          = '0x4200000000000000000000000000000000000006' as const // fallback team token (18dp)
const ZERO          = '0x0000000000000000000000000000000000000000' as const

const HOOK_FLAGS = 0xc0n // beforeSwap | afterSwap
const HOOK_MASK  = 0x3fffn
const MAX_LOOP   = 160_000
const FEE          = 3000
const TICK_SPACING = 60

const POOL_KEY_TUPLE = {
  type: 'tuple',
  components: [
    { name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' },
    { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' },
  ],
} as const

const PM_ABI = [{
  type: 'function', name: 'initialize', stateMutability: 'nonpayable',
  inputs: [{ ...POOL_KEY_TUPLE, name: 'key' }, { name: 'sqrtPriceX96', type: 'uint160' }],
  outputs: [{ name: 'tick', type: 'int24' }],
}] as const

const DECIMALS_ABI = [{
  type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }],
}] as const

/** Mirror HookMiner.find: mine a CREATE2 salt so the hook address carries exactly the 0xC0 bits.
 *  Random start so each deploy mines a DISTINCT hook (→ distinct PoolId), avoiding a re-run collision
 *  with an already-initialized pool. */
function mineHookSalt(initcode: `0x${string}`): { salt: `0x${string}`; hook: `0x${string}` } | null {
  const initcodeHash = keccak256(initcode)
  const start = Math.floor(Math.random() * 1_000_000_000)
  for (let i = 0; i < MAX_LOOP; i++) {
    const salt = toHex(BigInt(start + i), { size: 32 })
    const addr = getAddress(slice(keccak256(concat(['0xff', C2_FACTORY, salt, initcodeHash])), 12))
    if ((BigInt(addr) & HOOK_MASK) === HOOK_FLAGS) return { salt, hook: addr }
  }
  return null
}

function isqrt(n: bigint): bigint {
  if (n < 2n) return n
  let x = n
  let y = (x + 1n) / 2n
  while (y < x) { x = y; y = (x + n / x) / 2n }
  return x
}

/** sqrtPriceX96 for "1 whole currency0 = 1 whole currency1 in value" — the decimal-adjusted 1:1 start. */
function initSqrtPrice(dec0: number, dec1: number): bigint {
  return isqrt((10n ** BigInt(dec1) << 192n) / 10n ** BigInt(dec0))
}

export const POST = createHandler(async (req, ctx) => {
  const account = await getOracleSigner('root') // the Privy server wallet
  const transport = http(process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org')
  const publicClient = createPublicClient({ chain: baseSepolia, transport })
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport })

  const body = await req.clone().json().catch(() => ({} as Record<string, unknown>))
  let teamToken = (typeof body.teamToken === 'string' && isAddress(body.teamToken)) ? getAddress(body.teamToken) : WETH
  const circleTreasury = (typeof body.circleTreasury === 'string' && isAddress(body.circleTreasury))
    ? getAddress(body.circleTreasury) : account.address
  // mockUsdc: deploy a fresh public-mint MockERC20 as USDC + a no-op MockYieldAdapter, so the whole
  // stack is self-contained — the smoke route can mint its own test USDC (no faucet, no Aave dependency).
  const mockUsdc = body.mockUsdc === true
  // mockTeam: also deploy a fresh public-mint MockERC20 as the JUNIOR/team token (6dp), so the pool is
  // mock/mock and the JIT swap harness can mint both legs freely and trade with zero ETH beyond gas
  // (WETH-team would need real ETH to wrap for liquidity + swaps).
  const mockTeam = body.mockTeam === true
  if (!mockUsdc && !mockTeam && getAddress(teamToken) === getAddress(USDC)) {
    return ctx.json({ ok: false, step: 'preflight', error: 'teamToken must differ from USDC' }, 400)
  }

  const wait = (hash: `0x${string}`) => publicClient.waitForTransactionReceipt({ hash })
  const deployed = (r: { contractAddress: `0x${string}` | null | undefined }) => {
    if (!r.contractAddress) throw new Error('deploy produced no contract address')
    return r.contractAddress
  }

  try {
    // 0. Resolve the USDC + yield adapter — either the live Aave market, or a self-contained mock pair.
    let usdc: `0x${string}` = USDC
    let adapter: `0x${string}`
    if (mockUsdc) {
      usdc = deployed(await wait(await walletClient.deployContract({
        abi: MOCK_ERC20_ABI, bytecode: MOCK_ERC20_BYTECODE,
        args: ['USD Coin', 'USDC', 6], account, chain: baseSepolia,
      })))
      adapter = deployed(await wait(await walletClient.deployContract({
        abi: MOCK_ADAPTER_ABI, bytecode: MOCK_ADAPTER_BYTECODE,
        args: [usdc], account, chain: baseSepolia,
      })))
      // The mock adapter is ungated (no setVault) — nothing to authorize.
      // Optional mock team token so the whole pool is mock/mock (public-mint both legs).
      if (mockTeam) {
        teamToken = deployed(await wait(await walletClient.deployContract({
          abi: MOCK_ERC20_ABI, bytecode: MOCK_ERC20_BYTECODE,
          args: ['Team Token', 'TEAM', 6], account, chain: baseSepolia,
        })))
      }
    } else {
      // 1. Aave adapter (vault = 0; authorized after the vault exists).
      adapter = deployed(await wait(await walletClient.deployContract({
        abi: ADAPTER_ABI, bytecode: ADAPTER_BYTECODE,
        args: [AAVE_PROVIDER, USDC, AUSDC, ZERO, account.address], account, chain: baseSepolia,
      })))
    }

    // 2. Treasury vault.
    const vault = deployed(await wait(await walletClient.deployContract({
      abi: VAULT_ABI, bytecode: VAULT_BYTECODE,
      // AUDIT M1: 5th arg is the constructor-bound team (the address allowed to commitTeam). On testnet
      // the Privy deployer is both owner and team, so it can activate the vault via the commit route.
      args: [usdc, teamToken, adapter, account.address, account.address], account, chain: baseSepolia,
    })))
    if (!mockUsdc) {
      await wait(await walletClient.writeContract({
        address: adapter, abi: ADAPTER_ABI, functionName: 'setVault', args: [vault], account, chain: baseSepolia,
      }))
    }

    // 3. Sort currencies, mine + CREATE2-deploy the JIT hook (ctor ignores key.hooks → ZERO placeholder).
    const [c0, c1] = BigInt(usdc) < BigInt(teamToken) ? [usdc, teamToken] : [teamToken, usdc]
    const ctorKey = { currency0: c0, currency1: c1, fee: FEE, tickSpacing: TICK_SPACING, hooks: ZERO }
    const hookArgs = encodeAbiParameters(
      [{ type: 'address' }, POOL_KEY_TUPLE, { type: 'address' }, { type: 'address' }, { type: 'address' }],
      [POOL_MANAGER, ctorKey, usdc, vault, account.address],
    )
    const initcode = concat([HOOK_BYTECODE, hookArgs])
    const mined = mineHookSalt(initcode)
    if (!mined) return ctx.json({ ok: false, step: 'mine', error: 'no hook salt within MAX_LOOP' }, 500)
    await wait(await walletClient.sendTransaction({
      account, chain: baseSepolia, to: C2_FACTORY, data: concat([mined.salt, initcode]),
    }))
    const hook = mined.hook

    // 4. Open the pool WITH the hook at the decimal-adjusted start price.
    const dec0 = Number(await publicClient.readContract({ address: c0, abi: DECIMALS_ABI, functionName: 'decimals' }))
    const dec1 = Number(await publicClient.readContract({ address: c1, abi: DECIMALS_ABI, functionName: 'decimals' }))
    const sqrtPrice = (typeof body.initSqrtPrice === 'string' && /^\d+$/.test(body.initSqrtPrice))
      ? BigInt(body.initSqrtPrice) : initSqrtPrice(dec0, dec1)
    const realKey = { currency0: c0, currency1: c1, fee: FEE, tickSpacing: TICK_SPACING, hooks: hook }
    await wait(await walletClient.writeContract({
      address: POOL_MANAGER, abi: PM_ABI, functionName: 'initialize', args: [realKey, sqrtPrice], account, chain: baseSepolia,
    }))

    // 5. Module on the hooked pool.
    const module = deployed(await wait(await walletClient.deployContract({
      abi: MODULE_ABI, bytecode: MODULE_BYTECODE,
      args: [POOL_MANAGER, realKey, usdc, vault, account.address], account, chain: baseSepolia,
    })))

    // 6. Wire the vault ↔ module ↔ hook (skip JIT on the module's own recover/collect swaps).
    await wait(await walletClient.writeContract({ address: vault, abi: VAULT_ABI, functionName: 'setLiquidityModule', args: [module], account, chain: baseSepolia }))
    await wait(await walletClient.writeContract({ address: vault, abi: VAULT_ABI, functionName: 'setJitHook', args: [hook], account, chain: baseSepolia }))
    await wait(await walletClient.writeContract({ address: hook, abi: HOOK_ABI, functionName: 'setJitSkipSender', args: [module], account, chain: baseSepolia }))

    // 7. Gateway.
    const gateway = deployed(await wait(await walletClient.deployContract({
      abi: GATEWAY_ABI, bytecode: GATEWAY_BYTECODE,
      args: [vault, usdc, circleTreasury, account.address], account, chain: baseSepolia,
    })))
    await wait(await walletClient.writeContract({ address: vault, abi: VAULT_ABI, functionName: 'setGateway', args: [gateway], account, chain: baseSepolia }))
    await wait(await walletClient.writeContract({ address: vault, abi: VAULT_ABI, functionName: 'setProtocolTreasury', args: [circleTreasury], account, chain: baseSepolia }))

    return ctx.json({
      ok: true, chain: 'base-sepolia', deployer: account.address, mockUsdc,
      addresses: { adapter, vault, jitHook: hook, module, gateway, usdc, teamToken, poolManager: POOL_MANAGER },
      pool: { fee: FEE, tickSpacing: TICK_SPACING, sqrtPriceX96: sqrtPrice.toString(), dec0, dec1 },
      basescanVault: `https://sepolia.basescan.org/address/${vault}`,
      next: mockUsdc
        ? 'Self-contained mock stack. Team commitTeam(...) then POST /api/oracle/smoke-ypn-v2-testnet {vault} — it mints its own USDC (no faucet).'
        : 'Team calls vault.commitTeam(teamTokens, juniorUSDC, lockDur>=90d). Point edge-auth: EDGE_VAULT_KIND=v2, EDGE_VAULT_ADDRESS=vault, EDGE_GATEWAY_ADDRESS=gateway. Relayer → gateway.',
    })
  } catch (e) {
    return ctx.json({ ok: false, step: 'deploy', error: e instanceof Error ? e.message : String(e) }, 500)
  }
}, { auth: 'bearer-token' })
