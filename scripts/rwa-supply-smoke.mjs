// V2-RWAs smoke test: the exact contract calls the market page's SupplyPanel makes (approve → depositUSDC with a
// 1% minShares floor → redeemSenior with a 2% minAssets floor), run from the verified demo-trader Privy wallet
// with 25 valueless dUSD on Base Sepolia. Prints tx hashes only.
//   node --env-file=.env.robinhood.local scripts/rwa-supply-smoke.mjs
import fs from 'fs'
import { createPublicClient, createWalletClient, http, parseUnits, formatUnits } from 'viem'
import { baseSepolia } from 'viem/chains'
const D = JSON.parse(fs.readFileSync('config/rwaDemo.json', 'utf8'))
const { PrivyClient } = await import('@privy-io/server-auth')
const { createViemAccount } = await import('@privy-io/server-auth/viem')
const e = process.env
const privy = new PrivyClient(e.PRIVY_APP_ID, e.PRIVY_APP_SECRET)
const account = await createViemAccount({ walletId: e.RWA_TRADER_PRIVY_WALLET_ID, address: e.RWA_TRADER_PRIVY_ADDRESS, privy })
const rpc = 'https://base-sepolia-rpc.publicnode.com'
const pub = createPublicClient({ chain: baseSepolia, transport: http(rpc) })
const w = createWalletClient({ account, chain: baseSepolia, transport: http(rpc) })
const V = D.contracts.vault, U = D.contracts.usd
const VA = [
 { type:'function', name:'seniorShares', stateMutability:'view', inputs:[{type:'address'}], outputs:[{type:'uint256'}] },
 { type:'function', name:'convertToAssets', stateMutability:'view', inputs:[{type:'uint256'}], outputs:[{type:'uint256'}] },
 { type:'function', name:'previewDeposit', stateMutability:'view', inputs:[{type:'uint256'}], outputs:[{type:'uint256'}] },
 { type:'function', name:'depositUSDC', stateMutability:'nonpayable', inputs:[{type:'uint256'},{type:'uint256'},{type:'address'}], outputs:[{type:'uint256'}] },
 { type:'function', name:'redeemSenior', stateMutability:'nonpayable', inputs:[{type:'uint256'},{type:'uint256'}], outputs:[{type:'uint256'}] },
]
const EA = [{ type:'function', name:'approve', stateMutability:'nonpayable', inputs:[{type:'address'},{type:'uint256'}], outputs:[{type:'bool'}] }]
const send = async (label, req) => { await pub.simulateContract({ ...req, account }); const est = await pub.estimateContractGas({ ...req, account }); const h = await w.writeContract({ ...req, gas: est * 16n / 10n }); const r = await pub.waitForTransactionReceipt({ hash: h }); console.log(label, r.status, h); if (r.status !== 'success') process.exit(1); await new Promise(s=>setTimeout(s,6000)) }
const amt = parseUnits('25', 6)
const before = await pub.readContract({ address: V, abi: VA, functionName: 'seniorShares', args: [account.address] })
await send('approve', { address: U, abi: EA, functionName: 'approve', args: [V, amt] })
const prev = await pub.readContract({ address: V, abi: VA, functionName: 'previewDeposit', args: [amt] })
await send('supply ', { address: V, abi: VA, functionName: 'depositUSDC', args: [amt, prev * 99n / 100n, account.address] })
const sh = await pub.readContract({ address: V, abi: VA, functionName: 'seniorShares', args: [account.address] })
const minted = sh - before
const val = await pub.readContract({ address: V, abi: VA, functionName: 'convertToAssets', args: [minted] })
console.log('minted shares', minted.toString(), 'value', formatUnits(val, 6))
await send('redeem ', { address: V, abi: VA, functionName: 'redeemSenior', args: [minted, val * 98n / 100n] })
