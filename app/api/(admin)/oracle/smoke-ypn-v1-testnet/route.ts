// POST /api/oracle/smoke-ypn-v1-testnet   (route group (admin) is stripped from the URL)
//
// One-shot END-TO-END SMOKE of the live YPN v1 payment core on Base Sepolia, driven entirely by the
// Privy server wallet (getOracleSigner('root')) — NO user wallet, NO faucet clicking. Proves the REAL
// Gateway settlement path over real Aave, in one call:
//
//   1. Aave faucet mints test USDC to the deployer (the faucet OWNS the Aave-market USDC).
//   2. deployer approves + vault.deposit(USDC) → senior shares; USDC supplied to real Aave.
//   3. deployer signs an EIP-712 DelegatedSpendPermit (the "user" in the payment model).
//   4. deployer (RELAYER_ROLE) calls gateway.settleSpend(...) for a sub-$250 charge (permit-only path,
//      no edge-signer sig needed) → gateway burns shares via vault.burnForPayment → USDC to a receiver.
//   5. asserts the receiver was paid >= the charge (par), and returns every tx hash + balances.
//
// Bearer-gated (CRON_SECRET). TESTNET ONLY. Idempotent-ish: nonce/holdId derive from the block time so
// re-runs don't collide. Amounts are tiny ($ from the faucet cap). Override addrs via env if redeployed.

import { createPublicClient, createWalletClient, http, encodeAbiParameters, keccak256, toHex } from 'viem'
import { baseSepolia } from 'viem/chains'
import { createHandler } from '@/lib/web2/routeHandler'
import { ADMIN_SECRET } from '@/lib/constants'
import { getOracleSigner } from '@/lib/web3/oracleSigner'
import { YIELD_VAULT_ABI } from '@/lib/web3/artifacts/mintwareYieldVault'
import { PAYMENT_GATEWAY_ABI } from '@/lib/web3/artifacts/mintwarePaymentGateway'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Live deployment (2026-08-13) — override via env if redeployed.
const VAULT   = (process.env.YPN_VAULT_ADDRESS   || '0x7d92083dc80627d89a2ced1d911ac2bc1eb2b4df') as `0x${string}`
const GATEWAY = (process.env.YPN_GATEWAY_ADDRESS || '0x26ce3baff473b24e8afe932dfb6d68adca8048b0') as `0x${string}`
const USDC    = '0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f' as const
const FAUCET  = '0xd9145b5f45ad4519c7accd6e0a4a82e83bb8a6dc' as const // owns the Aave-market USDC
const RECEIVER = '0x000000000000000000000000000000000000dEaD' as `0x${string}` // distinct sink to read a clean delta

const MINT_AMT    = 1_000_000_000n // $1,000 from the faucet
const DEPOSIT_AMT = 1_000_000_000n // $1,000 deposited
const SPEND_AMT   = 100_000_000n   // $100 charge — below HIGH_VALUE_THRESHOLD ($250) → permit-only

const FAUCET_ABI = [{ type: 'function', name: 'mint', stateMutability: 'nonpayable',
  inputs: [{ name: 'token', type: 'address' }, { name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ name: '', type: 'uint256' }] }] as const
const ERC20_ABI = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 's', type: 'address' }, { name: 'a', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
] as const

export const POST = createHandler(async (_req, ctx) => {
  const account = await getOracleSigner('root')
  const transport = http(process.env.BASE_SEPOLIA_RPC_URL || 'https://base-sepolia-rpc.publicnode.com')
  const pub = createPublicClient({ chain: baseSepolia, transport })
  const wallet = createWalletClient({ account, chain: baseSepolia, transport })
  const user = account.address
  const txs: Record<string, string> = {}
  const send = async (label: string, hash: `0x${string}`) => {
    txs[label] = hash
    const r = await pub.waitForTransactionReceipt({ hash })
    if (r.status !== 'success') throw new Error(`${label} reverted (${hash})`)
  }

  if ((await pub.getBalance({ address: user })) === 0n) {
    return ctx.json({ ok: false, step: 'preflight', error: `deployer ${user} has 0 Base Sepolia ETH` }, 400)
  }

  // 1. Faucet-mint test USDC to the deployer.
  await send('faucetMint', await wallet.writeContract({ address: FAUCET, abi: FAUCET_ABI, functionName: 'mint', args: [USDC, user, MINT_AMT], account, chain: baseSepolia }))

  // 2. Approve + deposit → senior shares (USDC supplied to real Aave).
  await send('approve', await wallet.writeContract({ address: USDC, abi: ERC20_ABI, functionName: 'approve', args: [VAULT, DEPOSIT_AMT], account, chain: baseSepolia }))
  await send('deposit', await wallet.writeContract({ address: VAULT, abi: YIELD_VAULT_ABI, functionName: 'deposit', args: [DEPOSIT_AMT, user], account, chain: baseSepolia }))
  const sharesAfterDeposit = await pub.readContract({ address: VAULT, abi: YIELD_VAULT_ABI, functionName: 'shares', args: [user] }) as bigint
  const adapterBuffer = await pub.readContract({ address: VAULT, abi: YIELD_VAULT_ABI, functionName: 'idleBuffer' }) as bigint

  // 3. Sign the EIP-712 DelegatedSpendPermit as the "user" (nonce/deadline unique-ish per block).
  const latest = await pub.getBlock()
  const nonce = latest.timestamp
  const deadline = latest.timestamp + 3600n
  const permit = { user, maxDailySpendUSDC: 1_000_000_000n, nonce, deadline }
  const permitSig = await wallet.signTypedData({
    account,
    domain: { name: 'Mintware Payment Gateway', version: '2.0', chainId: baseSepolia.id, verifyingContract: GATEWAY },
    types: { DelegatedSpendPermit: [
      { name: 'user', type: 'address' }, { name: 'maxDailySpendUSDC', type: 'uint256' },
      { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
    ] },
    primaryType: 'DelegatedSpendPermit',
    message: permit,
  })

  // 4. Relayer settles a sub-$250 charge (edge-signer branch skipped) → burnForPayment → receiver.
  const holdId = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [user, nonce]))
  const emptyEdge = { holdId: toHex(0, { size: 32 }), user: '0x0000000000000000000000000000000000000000' as `0x${string}`, amountUSDC: 0n, nonce: 0n, expiry: 0n }
  const rcvBefore = await pub.readContract({ address: USDC, abi: ERC20_ABI, functionName: 'balanceOf', args: [RECEIVER] }) as bigint
  await send('settleSpend', await wallet.writeContract({
    address: GATEWAY, abi: PAYMENT_GATEWAY_ABI, functionName: 'settleSpend',
    args: [holdId, user, SPEND_AMT, RECEIVER, permit, permitSig, emptyEdge, '0x'],
    account, chain: baseSepolia,
  }))
  const rcvAfter = await pub.readContract({ address: USDC, abi: ERC20_ABI, functionName: 'balanceOf', args: [RECEIVER] }) as bigint

  // 5. Assert the receiver was paid at par.
  const paid = rcvAfter - rcvBefore
  const ok = paid >= SPEND_AMT

  return ctx.json({
    ok,
    chain: 'base_sepolia',
    proven: ok ? 'faucet → deposit(real Aave) → EIP-712 permit → relayer settleSpend → burnForPayment → receiver paid at par' : 'settlement did not pay the receiver at par',
    deployer: user, vault: VAULT, gateway: GATEWAY, receiver: RECEIVER,
    amounts: { minted: MINT_AMT.toString(), deposited: DEPOSIT_AMT.toString(), charged: SPEND_AMT.toString(), receiverPaid: paid.toString() },
    state: { sharesAfterDeposit: sharesAfterDeposit.toString(), idleBufferAfterDeposit: adapterBuffer.toString() },
    txs,
    basescan: { settle: `https://sepolia.basescan.org/tx/${txs.settleSpend}`, deposit: `https://sepolia.basescan.org/tx/${txs.deposit}` },
  }, ok ? 200 : 500)
}, { auth: 'bearer-token', bearerSecret: ADMIN_SECRET })
