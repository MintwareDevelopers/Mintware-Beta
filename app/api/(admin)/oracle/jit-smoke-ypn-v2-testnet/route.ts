// POST /api/oracle/jit-smoke-ypn-v2-testnet   (route group (admin) is stripped from the URL)
//
// The JIT SWAP HARNESS — fires a REAL Uniswap-V4 swap against the vault's pool so the JIT hook actually
// triggers, then sweeps and reports the realized `jitNetPnl`. This is what turns "the JIT guard is live"
// into "here is what MEV earned". Self-contained on a mock/mock stack — deploy it with
// {mockUsdc:true, mockTeam:true} then commit-team first, so both legs are public-mint (zero ETH beyond
// gas; a WETH team would need real ETH to wrap for liquidity + the trade).
//
// Flow (all keyless via the Privy server wallet):
//   1. deposit senior USDC so the vault has IDLE for the JIT to borrow
//   2. deploy a V4 swap router + LP router (or reuse via body {swapRouter, lpRouter})
//   3. mint both legs, add wide-range baseline liquidity so a trade can execute
//   4. swap team→USDC (jitThreshold=0 → any size fires JIT)
//   5. read jitBorrowed (position open), sweepJit, read jitBorrowed(0) + jitNetPnl (the round's PnL)
//
// Body (JSON): { vault (required), swapRouter?, lpRouter?, depositUsdc?, swapTeam?, liqUnits? }
// ⚠ Bearer-gated (CRON_SECRET). TESTNET ONLY (Base Sepolia). Requires ORACLE_SIGNER_PROVIDER=privy.

import { createPublicClient, createWalletClient, http, isAddress, getAddress, toHex } from 'viem'
import { baseSepolia } from 'viem/chains'
import { createHandler } from '@/lib/web2/routeHandler'
import { getOracleSigner } from '@/lib/web3/oracleSigner'
import { VAULT_ABI, HOOK_ABI } from '@/lib/web3/artifacts/treasuryV2'
import { SWAP_ROUTER_ABI, SWAP_ROUTER_BYTECODE, LP_ROUTER_ABI, LP_ROUTER_BYTECODE } from '@/lib/web3/artifacts/v4TestRouters'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const POOL_MANAGER = '0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408' as const // Base Sepolia V4 PoolManager
const FEE = 3000
const TICK_SPACING = 60
const TICK_LO = -887220 // (MIN_TICK / 60) * 60
const TICK_HI = 887220  // (MAX_TICK / 60) * 60
const SALT32 = toHex(0, { size: 32 })

const ERC20_ABI = [
  { type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
] as const

export const POST = createHandler(async (req, ctx) => {
  const account = await getOracleSigner('root')
  const transport = http(process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org')
  const publicClient = createPublicClient({ chain: baseSepolia, transport })
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport })
  const me = getAddress(account.address)

  const body = await req.clone().json().catch(() => ({} as Record<string, unknown>))
  if (typeof body.vault !== 'string' || !isAddress(body.vault)) {
    return ctx.json({ ok: false, step: 'preflight', error: 'vault (address) required' }, 400)
  }
  const vault = getAddress(body.vault)
  const num = (v: unknown, d: bigint) => (typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : d)
  const depositUsdc = num(body.depositUsdc, 20_000_000n)         // $20 senior → JIT has idle to borrow
  const swapTeam    = num(body.swapTeam, 2_000_000n)             // team sold → fires JIT
  const liqUnits    = num(body.liqUnits, 5_000_000_000_000n)     // liquidityDelta for baseline depth
  const BIG_MINT    = 200_000_000_000_000n                       // plenty of each leg for liquidity + trade

  const wait = (hash: `0x${string}`) => publicClient.waitForTransactionReceipt({ hash })
  const readV = <T,>(fn: string, args: readonly unknown[] = []) =>
    publicClient.readContract({ address: vault, abi: VAULT_ABI, functionName: fn as never, args: args as never }) as Promise<T>
  // poll a read past the public-RPC read-after-write lag (the harness reads state right after mined txs)
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const waitFor = async <T,>(read: () => Promise<T>, ok: (v: T) => boolean, tries = 8, delayMs = 1500): Promise<T> => {
    let v = await read()
    for (let i = 0; i < tries && !ok(v); i++) { await sleep(delayMs); v = await read() }
    return v
  }
  const mint = (tok: `0x${string}`, amt: bigint) =>
    walletClient.writeContract({ address: tok, abi: ERC20_ABI, functionName: 'mint', args: [me, amt], account, chain: baseSepolia, gas: 120_000n }).then(wait)
  const approve = (tok: `0x${string}`, spender: `0x${string}`, amt: bigint) =>
    walletClient.writeContract({ address: tok, abi: ERC20_ABI, functionName: 'approve', args: [spender, amt], account, chain: baseSepolia }).then(wait)
  const deploy = (abi: readonly unknown[], bytecode: `0x${string}`, args: readonly unknown[]) =>
    walletClient.deployContract({ abi: abi as never, bytecode, args: args as never, account, chain: baseSepolia }).then(wait).then((r) => {
      if (!r.contractAddress) throw new Error('deploy produced no contract address'); return getAddress(r.contractAddress)
    })

  try {
    if (!(await readV<boolean>('activated'))) return ctx.json({ ok: false, step: 'preflight', error: 'vault not activated — deploy {mockUsdc,mockTeam} + commit-team first' }, 409)
    const usdc = getAddress(await readV<`0x${string}`>('usdc'))
    const team = getAddress(await readV<`0x${string}`>('teamToken'))
    const hook = getAddress(await readV<`0x${string}`>('jitHook'))
    const [c0, c1] = BigInt(usdc) < BigInt(team) ? [usdc, team] : [team, usdc]
    const key = { currency0: c0, currency1: c1, fee: FEE, tickSpacing: TICK_SPACING, hooks: hook }

    // 1. Deposit senior USDC — the JIT borrows from the vault's idle senior. depositUsdc=0 SKIPS this,
    //    so a size-sweep can fire swap-only runs on a FIXED pool state (deposit + liquidity once, then
    //    vary swapTeam) instead of re-growing the senior base each run.
    if (depositUsdc > 0n) {
      await mint(usdc, depositUsdc)
      await approve(usdc, vault, depositUsdc)
      await walletClient.writeContract({ address: vault, abi: VAULT_ABI, functionName: 'depositUSDC', args: [depositUsdc, 0n, me], account, chain: baseSepolia, gas: 600_000n }).then(wait)
    }
    const seniorBefore = await readV<bigint>('totalSeniorAssets')

    // 2. Routers (reuse if provided — routers are stateless, safe to share across runs).
    const swapRouter = (typeof body.swapRouter === 'string' && isAddress(body.swapRouter)) ? getAddress(body.swapRouter) : await deploy(SWAP_ROUTER_ABI, SWAP_ROUTER_BYTECODE, [POOL_MANAGER])
    const lpRouter   = (typeof body.lpRouter === 'string' && isAddress(body.lpRouter)) ? getAddress(body.lpRouter) : await deploy(LP_ROUTER_ABI, LP_ROUTER_BYTECODE, [POOL_MANAGER])

    // 3. Baseline liquidity so a trade can execute (both legs public-mint). liqUnits=0 SKIPS this (reuse
    //    the depth from a prior run).
    if (liqUnits > 0n) {
      await mint(usdc, BIG_MINT); await mint(team, BIG_MINT)
      await approve(usdc, lpRouter, BIG_MINT); await approve(team, lpRouter, BIG_MINT)
      await walletClient.writeContract({
        address: lpRouter, abi: LP_ROUTER_ABI, functionName: 'modifyLiquidity',
        args: [key, { tickLower: TICK_LO, tickUpper: TICK_HI, liquidityDelta: liqUnits, salt: SALT32 }, '0x'],
        account, chain: baseSepolia, gas: 4_000_000n,
      }).then(wait)
    }

    // 4. Swap team→USDC — this makes USDC the OUTPUT, so the hook fires JIT (jitThreshold=0). zeroForOne
    //    = the team token is currency0. Snapshot cumulative PnL first so we can report THIS round's delta.
    const pnlBefore = await readV<bigint>('jitNetPnl')
    const zeroForOne = getAddress(team) === getAddress(c0)
    await mint(team, swapTeam); await approve(team, swapRouter, swapTeam)
    const swapTx = await walletClient.writeContract({
      address: swapRouter, abi: SWAP_ROUTER_ABI, functionName: 'swap',
      args: [key, zeroForOne, swapTeam], account, chain: baseSepolia, gas: 3_500_000n,
    })
    await wait(swapTx)

    // 5. The JIT position is open (claims minted); jitBorrowed is non-zero until the keeper sweeps.
    //    Poll past the RPC read-after-write lag so the response is trustworthy (not just the on-chain trace).
    const jitBorrowedOpen = await waitFor(() => readV<bigint>('jitBorrowed'), (v) => v > 0n)
    const sweepTx = await walletClient.writeContract({ address: hook, abi: HOOK_ABI, functionName: 'sweepJit', args: [], account, chain: baseSepolia, gas: 2_500_000n })
    await wait(sweepTx)
    const jitBorrowedAfterSweep = await waitFor(() => readV<bigint>('jitBorrowed'), (v) => v === 0n)
    // the round's realized PnL moved jitNetPnl off its pre-swap value (unless exactly 0) — poll for it
    const jitNetPnl = await waitFor(() => readV<bigint>('jitNetPnl'), (v) => v !== pnlBefore)
    const roundPnl = jitNetPnl - pnlBefore
    const seniorAfter = await readV<bigint>('totalSeniorAssets')

    return ctx.json({
      ok: true, chain: 'base-sepolia', vault, hook, usdc, team,
      routers: { swapRouter, lpRouter },
      jit: {
        fired: jitBorrowedOpen > 0n,
        borrowedWhileOpen: jitBorrowedOpen.toString(),
        borrowedAfterSweep: jitBorrowedAfterSweep.toString(),
        roundPnl: roundPnl.toString(),          // THIS swap's realized JIT PnL (6dp USDC, signed)
        jitNetPnlBefore: pnlBefore.toString(),
        jitNetPnl: (jitNetPnl as bigint).toString(), // cumulative after this round
        seniorBefore: seniorBefore.toString(),
        seniorAfter: seniorAfter.toString(),
      },
      swap: { teamSold: swapTeam.toString(), zeroForOne },
      txs: { swapTx, sweepTx },
      note: 'roundPnl = this swap\'s realized JIT PnL. Size-sweep: one full run (deposit+liquidity), then swap-only runs {vault, swapRouter, lpRouter, depositUsdc:"0", liqUnits:"0", swapTeam:<size>} to map roundPnl vs swap size.',
    })
  } catch (e) {
    return ctx.json({ ok: false, step: 'jit-smoke', error: e instanceof Error ? e.message : String(e) }, 500)
  }
}, { auth: 'bearer-token' })
