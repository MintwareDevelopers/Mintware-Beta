import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PAYMENT_GATEWAY_ABI } from './mintwarePaymentGateway'
import { YIELD_VAULT_ABI } from './mintwareYieldVault'

const root = process.cwd()
const gatewaySource = readFileSync(resolve(root, 'contracts-v4/src/payments/MintwarePaymentGateway.sol'), 'utf8')
const vaultSource = readFileSync(resolve(root, 'contracts-v4/src/payments/MintwareYieldVault.sol'), 'utf8')
const artifactAbi = (relativePath: string) => {
  const artifact = JSON.parse(readFileSync(resolve(root, relativePath), 'utf8')) as { abi: unknown }
  return artifact.abi
}
const functions = (abi: readonly { type: string; name?: string; inputs?: readonly { type: string; components?: readonly { type: string }[] }[] }[]) =>
  new Set(abi.filter((item) => item.type === 'function').map((item) => `${item.name}(${(item.inputs ?? []).map((input) => input.type === 'tuple' ? `(${(input.components ?? []).map((c) => c.type).join(',')})` : input.type).join(',')})`))

function expectSolidityFunctions(source: string, abi: readonly Parameters<typeof functions>[0][number][], signatures: string[]) {
  const abiFunctions = functions(abi)
  for (const signature of signatures) {
    const [name, args] = signature.split('(')
    const params = args.slice(0, -1).split(',').filter(Boolean)
    const declaration = new RegExp('function\\s+' + name + '\\s*\\(([\\s\\S]*?)\\)', 'm').exec(source)
    expect(declaration, `Solidity declaration ${signature}`).toBeTruthy()
    const solidityTypes = (declaration?.[1] ?? '').split(',').map((param) => param.trim().split(/\s+/)[0]).filter(Boolean)
    expect(solidityTypes, `Solidity parameter types for ${signature}`).toEqual(params)
    expect(abiFunctions.has(signature), `ABI declaration ${signature}`).toBe(true)
  }
}

describe('Earn vault and refill gateway ABIs', () => {
  it('matches checked-in compiled artifacts when Forge artifacts are available', () => {
    const gatewayArtifact = 'contracts-v4/out/MintwarePaymentGateway.sol/MintwarePaymentGateway.json'
    const vaultArtifact = 'contracts-v4/out/MintwareYieldVault.sol/MintwareYieldVault.json'
    if (!existsSync(resolve(root, gatewayArtifact)) || !existsSync(resolve(root, vaultArtifact))) return
    expect(PAYMENT_GATEWAY_ABI).toEqual(artifactAbi(gatewayArtifact))
    expect(YIELD_VAULT_ABI).toEqual(artifactAbi(vaultArtifact))
  })

  it('matches the Solidity refill, destination, and ERC-4626 signatures', () => {
    expectSolidityFunctions(gatewaySource, PAYMENT_GATEWAY_ABI, [
      'proposeBuffer(address)', 'acceptBuffer()', 'cancelBufferProposal()', 'revokeBuffer()',
      'refill(bytes32,address,uint256)', 'setUserCap(address,uint256)', 'confirmUserCap(address)',
      'cancelUserCap(address)', 'setGlobalCap(uint256)', 'confirmGlobalCap()', 'cancelGlobalCap()',
    ])
    expectSolidityFunctions(vaultSource, YIELD_VAULT_ABI, [
      'gatewayRedeem(address,uint256)', 'registerDestination(address,address)',
    ])
    expect(functions(PAYMENT_GATEWAY_ABI).has('settleSpend(bytes32,address,uint256,address,(address,uint256,uint256,uint256),bytes,(bytes32,address,uint256,uint256,uint256),bytes)')).toBe(false)
    expect(functions(PAYMENT_GATEWAY_ABI).has('refillBuffer(bytes32,address,address,uint256,(address,uint256,uint256,uint256),bytes)')).toBe(false)
  })
})
