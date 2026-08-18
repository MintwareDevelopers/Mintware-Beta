// RPC-backed ParkedReader — reads an agent's fee-net parked USDC straight off the YPN yield vault via
// eth_call: convertToAssets(shares(agent)). Selectors verified with `cast sig` against MintwareYieldVault.
// Spec: docs/developers/agentkit-compute-402-spec.md.

import { ParkedReader } from './treasury'

const SHARES_SEL = '0xce7c2ac2' //  shares(address)
const CONVERT_TO_ASSETS_SEL = '0x07a2d13a' //  convertToAssets(uint256)

function padAddress(addr: string): string {
  return addr.toLowerCase().replace(/^0x/, '').padStart(64, '0')
}
function padWord(hex: string): string {
  return hex.replace(/^0x/, '').padStart(64, '0')
}

export function rpcParkedReader(cfg: { rpcUrl: string; vault: string; fetchImpl?: typeof fetch }): ParkedReader {
  const f = cfg.fetchImpl ?? fetch
  async function ethCall(data: string): Promise<string> {
    const res = await f(cfg.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: cfg.vault, data }, 'latest'] }),
    })
    const j = (await res.json()) as { result?: string; error?: { message?: string } }
    if (j.error) throw new Error(`eth_call error: ${j.error.message ?? 'unknown'}`)
    if (!j.result || j.result === '0x') throw new Error('eth_call empty result')
    return j.result
  }
  return {
    async parkedAtomic(agent) {
      const shares = await ethCall(SHARES_SEL + padAddress(agent))
      if (BigInt(shares) === 0n) return 0n
      const assets = await ethCall(CONVERT_TO_ASSETS_SEL + padWord(shares))
      return BigInt(assets)
    },
  }
}
