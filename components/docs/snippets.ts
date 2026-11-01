// Displayed examples use the app ABI and deployment record, never copied addresses.
export const setupSnippet = `import deployments from '@/config/deployments.json'
import { MARKET_ENGINE_ABI as abi } from '@/lib/web3/artifacts/marketEngine'
import { erc20Abi, getAddress, parseEventLogs } from 'viem'

// publicClient and walletClient are your connected viem clients.
const deployment = deployments.testnet['base-sepolia'].MintwareMarketEngine
const engine = getAddress(deployment.address)
const [account] = await walletClient.getAddresses()
if (!account) throw new Error('Connect a wallet')
if (await publicClient.getChainId() !== deployment.chainId ||
    await walletClient.getChainId() !== deployment.chainId) {
  throw new Error('Switch both clients to the deployment chain')
}

const [token0, token1] = await Promise.all([
  publicClient.readContract({ address: engine, abi, functionName: 'token0' }),
  publicClient.readContract({ address: engine, abi, functionName: 'token1' }),
])`

export const depositSnippet = `// All amounts are bigint in token raw units; shares have 18 decimals.
// Choose minSharesOut from your quote and accepted slippage, not zero.
async function deposit(amount0: bigint, amount1: bigint, minSharesOut: bigint) {
  for (const [token, amount] of [[token0, amount0], [token1, amount1]] as const) {
    if (amount === 0n) continue
    const hash = await walletClient.writeContract({
      account, chain: walletClient.chain,
      address: token, abi: erc20Abi, functionName: 'approve',
      args: [engine, amount],
    })
    const approval = await publicClient.waitForTransactionReceipt({ hash })
    if (approval.status !== 'success') throw new Error('Approval reverted')
  }
  const { request } = await publicClient.simulateContract({
    account, address: engine, abi, functionName: 'deposit',
    args: [amount0, amount1, minSharesOut],
  })
  const hash = await walletClient.writeContract(request)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error('Deposit reverted')
  return parseEventLogs({ abi, eventName: 'Deposited',
    logs: receipt.logs.filter(log => log.address.toLowerCase() === engine.toLowerCase()),
  })
}`

export const withdrawSnippet = `// Redeem your own shares. No share-token approval to the engine is needed.
async function withdraw(shares: bigint, min0: bigint, min1: bigint) {
  const { request, result: preview } = await publicClient.simulateContract({
    account, address: engine, abi, functionName: 'withdraw',
    args: [shares, account, min0, min1],
  })
  // preview = [burned, amount0Out, amount1Out] at simulation time only.
  const hash = await walletClient.writeContract(request)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error('Withdrawal reverted')
  const events = parseEventLogs({ abi, eventName: 'Withdrawn',
    logs: receipt.logs.filter(log => log.address.toLowerCase() === engine.toLowerCase()),
  })
  // Use sharesBurned and delivered amounts from events, not requested shares.
  return { preview, events }
}`
