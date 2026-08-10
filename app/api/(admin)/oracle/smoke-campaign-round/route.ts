// POST /api/oracle/smoke-campaign-round   (route group (admin) is stripped from the URL)
//
// End-to-end TESTNET smoke test of the campaign/earn distributor (MintwareDistributor v2) on Base
// Sepolia — the full money round: deploy a mintable mock token → mint → registerCampaign → approve →
// depositCampaign → build a 1-leaf Merkle tree → oracle-sign the root (EIP-712) → claim → assert the
// claimant's balance moved by exactly the claimed amount. Everything runs AS the Privy wallet, which
// is both the contract owner (registrar) and the oracle signer, so no external faucet token or extra
// keys are needed. Proves deposit + claim actually work against the deployed contract.
//
// Bearer-gated (CRON_SECRET). TESTNET ONLY — Base Sepolia hardcoded. Deploys a throwaway mock token
// and a throwaway campaign each run; nothing production-facing is touched.

import { createPublicClient, createWalletClient, http } from 'viem'
import { baseSepolia } from 'viem/chains'
import { randomUUID } from 'node:crypto'
import { StandardMerkleTree } from '@openzeppelin/merkle-tree'
import { createHandler } from '@/lib/web2/routeHandler'
import { getOracleSigner } from '@/lib/web3/oracleSigner'
import { CAMPAIGN_DISTRIBUTOR_ABI } from '@/lib/web3/artifacts/campaignDistributor'
import { MOCK_ERC20_ABI, MOCK_ERC20_BYTECODE } from '@/lib/web3/artifacts/mockErc20'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const KNOWN_DISTRIBUTOR = '0xD69A9F96c85114D949Ba8f49dE0A455f152c93A3' as const
const MINT = 1000n * 10n ** 18n
const DEPOSIT = 500n * 10n ** 18n
const CLAIM = 100n * 10n ** 18n
const EPOCH = 1n
const FAR_FUTURE = 9_999_999_999n

export const POST = createHandler(async (_req, ctx) => {
  const account = await getOracleSigner('root') // Privy wallet: owner + oracle signer
  const transport = http(process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org')
  const publicClient = createPublicClient({ chain: baseSepolia, transport })
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport })

  const distributor =
    (process.env.NEXT_PUBLIC_DISTRIBUTOR_ADDRESS_BASE_SEPOLIA as `0x${string}` | undefined) ||
    KNOWN_DISTRIBUTOR

  if ((await publicClient.getBalance({ address: account.address })) === 0n) {
    return ctx.json({ ok: false, step: 'preflight', deployer: account.address,
      error: `Deployer ${account.address} holds 0 Base Sepolia ETH — fund it, then retry.` }, 400)
  }

  const txs: Record<string, string> = {}
  const wait = (hash: `0x${string}`) => publicClient.waitForTransactionReceipt({ hash })

  // 1. Deploy a mintable mock token.
  const tokenDeployTx = await walletClient.deployContract({
    abi: MOCK_ERC20_ABI, bytecode: MOCK_ERC20_BYTECODE, account, chain: baseSepolia,
    args: ['MW Smoke', 'MWS', 18],
  })
  txs.tokenDeployTx = tokenDeployTx
  const tokenRcpt = await wait(tokenDeployTx)
  const token = tokenRcpt.contractAddress
  if (tokenRcpt.status !== 'success' || !token) {
    return ctx.json({ ok: false, step: 'token-deploy', txs, error: 'mock token deploy reverted' }, 500)
  }

  // 2. Mint to the Privy wallet.
  txs.mintTx = await walletClient.writeContract({
    address: token, abi: MOCK_ERC20_ABI, functionName: 'mint', args: [account.address, MINT], account, chain: baseSepolia,
  })
  await wait(txs.mintTx as `0x${string}`)

  // 3. Register a fresh campaign (owner ⇒ implicit registrar), creator = the Privy wallet.
  const campaignId = `smoke-${randomUUID()}`
  txs.registerTx = await walletClient.writeContract({
    address: distributor, abi: CAMPAIGN_DISTRIBUTOR_ABI, functionName: 'registerCampaign',
    args: [campaignId, token, account.address], account, chain: baseSepolia,
  })
  await wait(txs.registerTx as `0x${string}`)

  // 4. Approve + deposit into the campaign pool.
  txs.approveTx = await walletClient.writeContract({
    address: token, abi: MOCK_ERC20_ABI, functionName: 'approve', args: [distributor, DEPOSIT], account, chain: baseSepolia,
  })
  await wait(txs.approveTx as `0x${string}`)
  txs.depositTx = await walletClient.writeContract({
    address: distributor, abi: CAMPAIGN_DISTRIBUTOR_ABI, functionName: 'depositCampaign', args: [campaignId, token, DEPOSIT], account, chain: baseSepolia,
  })
  await wait(txs.depositTx as `0x${string}`)

  // 5. Build a single-leaf Merkle tree (claimant = the Privy wallet) + oracle-sign the root.
  const tree = StandardMerkleTree.of([[account.address, CLAIM.toString()]], ['address', 'uint256'])
  const merkleRoot = tree.root as `0x${string}`
  const proof = tree.getProof(0) as `0x${string}`[]
  const oracleSignature = await account.signTypedData({
    domain: { name: 'MintwareDistributor', version: '1', chainId: baseSepolia.id, verifyingContract: distributor },
    types: { RootPublication: [
      { name: 'campaignId', type: 'string' },
      { name: 'epochNumber', type: 'uint256' },
      { name: 'merkleRoot', type: 'bytes32' },
      { name: 'deadline', type: 'uint256' },
    ] },
    primaryType: 'RootPublication',
    message: { campaignId, epochNumber: EPOCH, merkleRoot, deadline: FAR_FUTURE },
  })

  // 6. Claim + assert the balance moved by exactly CLAIM.
  const balBefore = (await publicClient.readContract({ address: token, abi: MOCK_ERC20_ABI, functionName: 'balanceOf', args: [account.address] })) as bigint
  txs.claimTx = await walletClient.writeContract({
    address: distributor, abi: CAMPAIGN_DISTRIBUTOR_ABI, functionName: 'claim',
    args: [campaignId, EPOCH, merkleRoot, oracleSignature, FAR_FUTURE, CLAIM, proof], account, chain: baseSepolia,
  })
  const claimRcpt = await wait(txs.claimTx as `0x${string}`)
  const balAfter = (await publicClient.readContract({ address: token, abi: MOCK_ERC20_ABI, functionName: 'balanceOf', args: [account.address] })) as bigint

  const delta = balAfter - balBefore
  const claimPaidExactly = delta === CLAIM

  return ctx.json({
    ok: claimRcpt.status === 'success' && claimPaidExactly,
    chain: 'base_sepolia',
    distributor,
    token,
    campaignId,
    claimant: account.address,
    amounts: { minted: MINT.toString(), deposited: DEPOSIT.toString(), claimed: CLAIM.toString() },
    balanceBefore: balBefore.toString(),
    balanceAfter: balAfter.toString(),
    claimDelta: delta.toString(),
    claimPaidExactly,
    merkleRoot,
    txs,
    basescanClaim: `https://sepolia.basescan.org/tx/${txs.claimTx}`,
  })
}, { auth: 'bearer-token' })
