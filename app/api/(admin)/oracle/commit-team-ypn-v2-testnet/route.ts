// POST /api/oracle/commit-team-ypn-v2-testnet   (route group (admin) is stripped from the URL)
//
// Activates a deployed YPN v2 treasury vault by having the Privy server wallet
// (getOracleSigner('root')) commit the junior reserve — the keyless counterpart to commitTeam that a
// raw `cast --private-key` can't do (the deployer/team wallet is Privy-custodied, no exportable key).
//
// It reads the vault's team token; if that token is WETH it wraps `teamTokens` of the wallet's ETH
// first (so a fresh testnet wallet needs only ETH). Then approve → commitTeam → the vault is activated
// and open for community USDC deposits. The Privy wallet becomes the vault's `team`.
//
// Body (JSON): { vault (required), teamTokens?, juniorUsdc?, lockDays? }
//   teamTokens — junior token (WETH) base units to commit (default 0.1e18).
//   juniorUsdc — OPTIONAL stable first-loss USDC to also commit (6dp; default 0). The Privy wallet must
//                already hold this much USDC — the route does not source it.
//   lockDays   — junior hard lock in days (>= 90; default 90).
//
// ⚠ Bearer-gated (CRON_SECRET). TESTNET ONLY. Requires ORACLE_SIGNER_PROVIDER=privy + a funded wallet.

import { createPublicClient, createWalletClient, http, isAddress, getAddress } from 'viem'
import { baseSepolia } from 'viem/chains'
import { createHandler } from '@/lib/web2/routeHandler'
import { getOracleSigner } from '@/lib/web3/oracleSigner'
import { VAULT_ABI } from '@/lib/web3/artifacts/treasuryV2'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const WETH = '0x4200000000000000000000000000000000000006' as const // Base WETH9 predeploy (deposit/withdraw)
const MIN_LOCK_DAYS = 90

const ERC20_ABI = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'deposit', stateMutability: 'payable', inputs: [], outputs: [] }, // WETH wrap
] as const

export const POST = createHandler(async (req, ctx) => {
  const account = await getOracleSigner('root')
  const transport = http(process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org')
  const publicClient = createPublicClient({ chain: baseSepolia, transport })
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport })

  const body = await req.clone().json().catch(() => ({} as Record<string, unknown>))
  if (typeof body.vault !== 'string' || !isAddress(body.vault)) {
    return ctx.json({ ok: false, step: 'preflight', error: 'vault (address) required' }, 400)
  }
  const vault = getAddress(body.vault)
  const teamTokens = typeof body.teamTokens === 'string' && /^\d+$/.test(body.teamTokens)
    ? BigInt(body.teamTokens) : 100_000_000_000_000_000n // 0.1e18
  const juniorUsdc = typeof body.juniorUsdc === 'string' && /^\d+$/.test(body.juniorUsdc) ? BigInt(body.juniorUsdc) : 0n
  const lockDays = typeof body.lockDays === 'number' && body.lockDays >= MIN_LOCK_DAYS ? Math.floor(body.lockDays) : MIN_LOCK_DAYS
  if (teamTokens === 0n) return ctx.json({ ok: false, step: 'preflight', error: 'teamTokens must be > 0' }, 400)

  const wait = (hash: `0x${string}`) => publicClient.waitForTransactionReceipt({ hash })

  try {
    const alreadyActive = await publicClient.readContract({ address: vault, abi: VAULT_ABI, functionName: 'activated' })
    if (alreadyActive) return ctx.json({ ok: false, step: 'preflight', error: 'vault already activated' }, 409)

    const teamToken = getAddress(await publicClient.readContract({ address: vault, abi: VAULT_ABI, functionName: 'teamToken' }) as `0x${string}`)
    const usdc = getAddress(await publicClient.readContract({ address: vault, abi: VAULT_ABI, functionName: 'usdc' }) as `0x${string}`)

    // 1. If the junior token is WETH, wrap the ETH so a fresh wallet needs only native gas.
    let wrapTx: `0x${string}` | null = null
    if (getAddress(teamToken) === getAddress(WETH)) {
      wrapTx = await walletClient.writeContract({ address: teamToken, abi: ERC20_ABI, functionName: 'deposit', args: [], value: teamTokens, account, chain: baseSepolia })
      await wait(wrapTx)
    }

    // 2. Approve the junior legs to the vault.
    await wait(await walletClient.writeContract({ address: teamToken, abi: ERC20_ABI, functionName: 'approve', args: [vault, teamTokens], account, chain: baseSepolia }))
    if (juniorUsdc > 0n) {
      await wait(await walletClient.writeContract({ address: usdc, abi: ERC20_ABI, functionName: 'approve', args: [vault, juniorUsdc], account, chain: baseSepolia }))
    }

    // 3. Commit — activates the vault; the Privy wallet becomes `team`.
    const commitTx = await walletClient.writeContract({
      address: vault, abi: VAULT_ABI, functionName: 'commitTeam',
      args: [teamTokens, juniorUsdc, BigInt(lockDays) * 86_400n], account, chain: baseSepolia,
    })
    await wait(commitTx)

    const [activated, team, lockExpiry] = await Promise.all([
      publicClient.readContract({ address: vault, abi: VAULT_ABI, functionName: 'activated' }),
      publicClient.readContract({ address: vault, abi: VAULT_ABI, functionName: 'team' }),
      publicClient.readContract({ address: vault, abi: VAULT_ABI, functionName: 'lockExpiry' }),
    ])

    return ctx.json({
      ok: true, chain: 'base-sepolia', vault, team, activated,
      committed: { teamToken, teamTokens: teamTokens.toString(), juniorUsdc: juniorUsdc.toString(), lockDays },
      lockExpiry: (lockExpiry as bigint).toString(),
      txs: { wrapTx, commitTx },
      next: 'Vault is open for community USDC deposits (vault.depositUSDC). Point edge-auth EDGE_VAULT_KIND=v2 + the vault/gateway addresses.',
    })
  } catch (e) {
    return ctx.json({ ok: false, step: 'commit', error: e instanceof Error ? e.message : String(e) }, 500)
  }
}, { auth: 'bearer-token' })
