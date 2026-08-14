// POST /api/oracle/smoke-ypn-v2-testnet   (route group (admin) is stripped from the URL)
//
// End-to-end smoke of the deployed YPN v2 treasury-vault stack on Base Sepolia, driven entirely by the
// Privy server wallet (getOracleSigner('root')) — the keyless proof that v2 works as a *system*, not
// just as deployed bytecode. It exercises the core LSA money-loop against the LIVE contracts:
//
//   1. deposit   — approve + vault.depositUSDC(): community USDC in → senior shares minted (idle buffer).
//   2. settle    — gateway.settleSpend(): a card charge burns senior shares and redeems USDC to the
//                  Circle treasury. The Privy wallet plays user (signs the EIP-712 DelegatedSpendPermit),
//                  relayer (has RELAYER_ROLE), and — since circleCpnTreasury == the deployer — receiver,
//                  so the loop is self-contained and USDC recycles back. Charge is kept < $250 so no
//                  edge-signature leg is required.
//   3. deploy    — (optional, `deployUsdc` > 0) vault.deployToLP(): proves the REAL V4 module deploys
//                  two-sided liquidity on the LIVE hooked pool. Run AFTER settle so idle stays intact.
//
// The on-chain JIT-swap leg is intentionally NOT driven here: firing a real V4 swap needs a deployed V4
// swap router + a WETH trade, and JIT is already proven by the fork-fuzz suite (MintwareTreasuryJitStack).
//
// Body (JSON): { vault, gateway?, depositUsdc?, settleUsdc?, deployUsdc? }
//   gateway     — defaults to vault.gateway().
//   depositUsdc — 6dp USDC to deposit as senior (default 10_000000 = $10). The Privy wallet must already
//                 hold this much of the vault's USDC — the route does NOT source it (mock USDC minter is
//                 not the deployer). Top up 0x7fD88…7E06 with test USDC + gas first.
//   settleUsdc  — 6dp card charge to settle (default 1_000000 = $1; must be < $250 and <= idle).
//   deployUsdc  — 6dp senior USDC to deploy to LP after settle (default 0 = skip).
//
// ⚠ Bearer-gated (CRON_SECRET). TESTNET ONLY. Requires ORACLE_SIGNER_PROVIDER=privy + a funded wallet.

import { createPublicClient, createWalletClient, http, isAddress, getAddress, keccak256, toHex, encodePacked, zeroAddress } from 'viem'
import { baseSepolia } from 'viem/chains'
import { createHandler } from '@/lib/web2/routeHandler'
import { getOracleSigner } from '@/lib/web3/oracleSigner'
import { VAULT_ABI, GATEWAY_ABI } from '@/lib/web3/artifacts/treasuryV2'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const ERC20_ABI = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
] as const

const HIGH_VALUE_THRESHOLD = 250_000_000n // $250 (6dp) — at/above this settleSpend needs an edge sig.

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
  const depositUsdc = num(body.depositUsdc, 10_000_000n) // $10
  const settleUsdc  = num(body.settleUsdc, 1_000_000n)   // $1
  const deployUsdc  = num(body.deployUsdc, 0n)           // skip by default

  if (settleUsdc >= HIGH_VALUE_THRESHOLD) {
    return ctx.json({ ok: false, step: 'preflight', error: 'settleUsdc must be < $250 (no edge-sig leg in the smoke)' }, 400)
  }

  const wait = (hash: `0x${string}`) => publicClient.waitForTransactionReceipt({ hash })
  const readV = <T,>(fn: string, args: readonly unknown[] = []) => publicClient.readContract({ address: vault, abi: VAULT_ABI, functionName: fn, args }) as Promise<T>

  try {
    const activated = await readV<boolean>('activated')
    if (!activated) return ctx.json({ ok: false, step: 'preflight', error: 'vault not activated — run commit-team first' }, 409)

    const usdc = getAddress(await readV<`0x${string}`>('usdc'))
    const gateway = typeof body.gateway === 'string' && isAddress(body.gateway)
      ? getAddress(body.gateway)
      : getAddress(await readV<`0x${string}`>('gateway'))

    // ── funding preflight (the route does not mint — the mock USDC minter is not the deployer) ──
    const usdcHeld = await publicClient.readContract({ address: usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [me] }) as bigint
    if (usdcHeld < depositUsdc) {
      return ctx.json({
        ok: false, step: 'funding',
        error: `Privy wallet holds ${usdcHeld} USDC (6dp) but needs ${depositUsdc}. Top up ${me} with the vault's test USDC (${usdc}) + Base Sepolia ETH for gas.`,
        wallet: me, usdc, held: usdcHeld.toString(), needed: depositUsdc.toString(),
      }, 412)
    }

    // ── 1. DEPOSIT — approve (idempotent) + depositUSDC ──
    const allowance = await publicClient.readContract({ address: usdc, abi: ERC20_ABI, functionName: 'allowance', args: [me, vault] }) as bigint
    let approveTx: `0x${string}` | null = null
    if (allowance < depositUsdc) {
      approveTx = await walletClient.writeContract({ address: usdc, abi: ERC20_ABI, functionName: 'approve', args: [vault, depositUsdc], account, chain: baseSepolia })
      await wait(approveTx)
    }
    const depositTx = await walletClient.writeContract({
      address: vault, abi: VAULT_ABI, functionName: 'depositUSDC', args: [depositUsdc, 0n, me],
      account, chain: baseSepolia, gas: 600_000n,
    })
    await wait(depositTx)
    const sharesAfter = await readV<bigint>('seniorShares', [me])
    const idleAfterDeposit = await readV<bigint>('idleBuffer')

    // ── 2. SETTLE — self-signed EIP-712 permit + self-relayer settleSpend ──
    if (idleAfterDeposit < settleUsdc) {
      return ctx.json({ ok: false, step: 'settle', error: `idle buffer ${idleAfterDeposit} < settleUsdc ${settleUsdc}` }, 409)
    }
    const nowSec = BigInt(Math.floor(Date.now() / 1000))
    const deadline = nowSec + 3600n
    const permitNonce = nowSec // revocation-only nonce; unique per run is fine
    const permit = { user: me, maxDailySpendUSDC: 100_000_000n /* $100 */, nonce: permitNonce, deadline }
    const permitSig = await account.signTypedData({
      domain: { name: 'Mintware Payment Gateway', version: '2.0', chainId: baseSepolia.id, verifyingContract: gateway },
      types: {
        DelegatedSpendPermit: [
          { name: 'user', type: 'address' },
          { name: 'maxDailySpendUSDC', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'DelegatedSpendPermit',
      message: permit,
    })
    // Unique holdId per settlement; below $250 the edgeAuth leg is skipped, so pass a zeroed struct.
    const holdId = keccak256(encodePacked(['address', 'uint256', 'uint256'], [me, settleUsdc, permitNonce]))
    const emptyEdgeAuth = { holdId: toHex(0, { size: 32 }), user: zeroAddress, amountUSDC: 0n, nonce: 0n, expiry: 0n }

    const settleTx = await walletClient.writeContract({
      address: gateway, abi: GATEWAY_ABI, functionName: 'settleSpend',
      args: [holdId, me, settleUsdc, zeroAddress, permit, permitSig, emptyEdgeAuth, '0x'],
      account, chain: baseSepolia, gas: 700_000n,
    })
    await wait(settleTx)
    const sharesAfterSettle = await readV<bigint>('seniorShares', [me])

    // ── 3. DEPLOY TO LP (optional) — proves the real V4 module on the live hooked pool ──
    let deployTx: `0x${string}` | null = null
    let deployedFromSenior = 0n
    if (deployUsdc > 0n) {
      const jt = await readV<bigint>('juniorTokens')
      deployTx = await walletClient.writeContract({
        address: vault, abi: VAULT_ABI, functionName: 'deployToLP', args: [deployUsdc, jt],
        account, chain: baseSepolia, gas: 2_000_000n,
      })
      await wait(deployTx)
      deployedFromSenior = await readV<bigint>('deployedFromSenior').catch(() => 0n)
    }

    return ctx.json({
      ok: true, chain: 'base-sepolia', vault, gateway, usdc, wallet: me,
      deposit: { usdc: depositUsdc.toString(), sharesMinted: sharesAfter.toString(), idleAfter: idleAfterDeposit.toString(), approveTx, depositTx },
      settle:  { usdc: settleUsdc.toString(), holdId, sharesBurned: (sharesAfter - sharesAfterSettle).toString(), sharesRemaining: sharesAfterSettle.toString(), settleTx },
      deploy:  deployUsdc > 0n ? { usdc: deployUsdc.toString(), deployedFromSenior: deployedFromSenior.toString(), deployTx } : 'skipped',
      note: 'Core LSA loop proven live: senior USDC deposit → card charge burned shares + redeemed USDC to treasury. JIT swap leg is covered by the fork-fuzz suite.',
    })
  } catch (e) {
    return ctx.json({ ok: false, step: 'smoke', error: e instanceof Error ? e.message : String(e) }, 500)
  }
}, { auth: 'bearer-token' })
