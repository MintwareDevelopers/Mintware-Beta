import { type PublicClient, type Address } from 'viem'
import { readMarketEngineSnapshot, verifyMarketEngine } from '@/lib/gateway/marketEngine'
import { RWA_HOOK_ABI, PERMISSIONS_ADAPTER_ABI } from '@/lib/web3/artifacts/marketEngine'
import type { ReadClient } from '@/lib/gateway/registry'

export async function readRwaUnit(client: Pick<PublicClient, 'readContract' | 'getCode'> & { getBlock: () => Promise<{ number: bigint; timestamp: bigint }> }, engine: Address, account?: Address) {
  const head = await client.getBlock()
  const blockNumber = head.number
  const pinned: ReadClient = {
    readContract: (args) => client.readContract({ ...args, blockNumber }),
    getCode: (args) => client.getCode({ ...args, blockNumber }),
  }
  const verification = await verifyMarketEngine({ client: pinned, address: engine, chainId: 84532, allowInactive: true })
  if (!verification.ok) throw new Error(verification.error)
  const hook = verification.poolKey.hooks
  if (/^0x0{40}$/.test(hook)) throw new Error('owned_engine_required')
  const [snapshot, mark, band, config, oracleReady, paused, adapter] = await Promise.all([
    readMarketEngineSnapshot(client, engine, blockNumber, account),
    client.readContract({ address: hook, abi: RWA_HOOK_ABI, functionName: 'latestMark', blockNumber }),
    client.readContract({ address: hook, abi: RWA_HOOK_ABI, functionName: 'bandStatus', blockNumber }),
    client.readContract({ address: hook, abi: RWA_HOOK_ABI, functionName: 'config', blockNumber }),
    client.readContract({ address: hook, abi: RWA_HOOK_ABI, functionName: 'oracleReady', blockNumber }),
    client.readContract({ address: hook, abi: RWA_HOOK_ABI, functionName: 'tradingPaused', blockNumber }),
    client.readContract({ address: hook, abi: RWA_HOOK_ABI, functionName: 'permissionsAdapter', blockNumber }),
  ])
  const permission = (who: Address, flag: '0x0001' | '0x0002') => client.readContract({ address: adapter, abi: PERMISSIONS_ADAPTER_ABI, functionName: 'isAllowed', args: [who, flag], blockNumber })
  const [engineWrapper, engineLiquidity, swappingEnabled, accountSwap, accountLiquidity] = await Promise.all([
    client.readContract({ address: adapter, abi: PERMISSIONS_ADAPTER_ABI, functionName: 'allowedWrappers', args: [engine], blockNumber }),
    permission(engine, '0x0002'),
    client.readContract({ address: adapter, abi: PERMISSIONS_ADAPTER_ABI, functionName: 'swappingEnabled', blockNumber }),
    account ? permission(account, '0x0001') : null, account ? permission(account, '0x0002') : null,
  ])
  return {
    ok: true as const, source: 'live' as const, block: Number(blockNumber), blockTime: Number(head.timestamp), engine: snapshot,
    hook: { address: hook, adapter, priceWad: mark[0].toString(), observedAt: Number(mark[1]), spotTick: band[0], appraisalTick: band[1],
      deviationTicks: Number(band[2]), inCore: band[3], inSpec: band[4], fresh: band[5], oracleReady, paused,
      coreBandTicks: config[0], specBandTicks: config[1], maxAgeSecs: config[4], coreFeePips: config[5], specFeePips: config[6],
      permissions: { engineWrapper, engineLiquidity, swappingEnabled, accountSwap, accountLiquidity } },
  }
}
export type RwaUnitLive = Omit<Awaited<ReturnType<typeof readRwaUnit>>, 'source' | 'engine' | 'hook' | 'block' | 'blockTime'> & {
  source: 'live' | 'cached' | 'undeployed'
  engine: Awaited<ReturnType<typeof readMarketEngineSnapshot>> | null
  hook: Awaited<ReturnType<typeof readRwaUnit>>['hook'] | null
  block: number | null
  blockTime: number | null
}
