import { describe, it, expect } from 'vitest'
import { buildTreasuryDeployEnv, trancheCommitPlan } from './treasuryProvisioning'
import type { VaultTrancheIntent } from '../signedActionMessages'

const tranche: VaultTrancheIntent = { juniorCommitUsdc: 100_000, lockDays: 180, teamUsdc: 25_000, subordinateUsdc: true }
const rec = { projectToken: '0xteam', poolKey: { fee: 3000, tickSpacing: 60 }, tranche }

describe('buildTreasuryDeployEnv', () => {
  it('maps the intent + infra to the DeployTreasuryV2 env', () => {
    const env = buildTreasuryDeployEnv(rec, {
      poolManager: '0xpm',
      usdc: '0xusdc',
      adapter: '0xadapter',
      circleTreasury: '0xtreasury',
      edgeSigner: '0xedge',
      relayer: '0xrelayer',
      initSqrtPrice: '79228162514264337593543950336000000',
    })
    expect(env.V4_POOL_MANAGER).toBe('0xpm')
    expect(env.USDC_ADDRESS).toBe('0xusdc')
    expect(env.TEAM_TOKEN_ADDRESS).toBe('0xteam')
    expect(env.ADAPTER_ADDRESS).toBe('0xadapter')
    expect(env.CIRCLE_TREASURY).toBe('0xtreasury')
    expect(env.POOL_FEE).toBe('3000')
    expect(env.TICK_SPACING).toBe('60')
    expect(env.INIT_SQRT_PRICE).toBe('79228162514264337593543950336000000')
    expect(env.EDGE_SIGNER).toBe('0xedge')
    expect(env.RELAYER).toBe('0xrelayer')
  })

  it('omits optional env keys when not supplied', () => {
    const env = buildTreasuryDeployEnv(rec, {
      poolManager: '0xpm', usdc: '0xusdc', adapter: '0xadapter', circleTreasury: '0xtreasury',
    })
    expect(env.INIT_SQRT_PRICE).toBeUndefined()
    expect(env.EDGE_SIGNER).toBeUndefined()
    expect(env.RELAYER).toBeUndefined()
  })
})

describe('trancheCommitPlan', () => {
  it('subordinated team USDC → the junior buffer (commitTeam 2nd arg)', () => {
    const plan = trancheCommitPlan({ juniorCommitUsdc: 100_000, lockDays: 180, teamUsdc: 25_000, subordinateUsdc: true })
    expect(plan.juniorUsdc6dp).toBe('25000000000') // 25_000 * 1e6
    expect(plan.seniorUsdc6dp).toBe('0')
    expect(plan.lockSeconds).toBe(180 * 86_400)
    expect(plan.juniorCommitUsdcValue).toBe(100_000)
  })

  it('non-subordinated team USDC → a separate senior deposit', () => {
    const plan = trancheCommitPlan({ juniorCommitUsdc: 100_000, lockDays: 90, teamUsdc: 25_000, subordinateUsdc: false })
    expect(plan.juniorUsdc6dp).toBe('0')
    expect(plan.seniorUsdc6dp).toBe('25000000000')
    expect(plan.lockSeconds).toBe(90 * 86_400)
  })

  it('no team USDC → both legs zero regardless of the flag', () => {
    const plan = trancheCommitPlan({ juniorCommitUsdc: 100_000, lockDays: 90, teamUsdc: 0, subordinateUsdc: true })
    expect(plan.juniorUsdc6dp).toBe('0')
    expect(plan.seniorUsdc6dp).toBe('0')
  })
})
