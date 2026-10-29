// GET /api/admin/oracle/signer-check
//
// Read-only diagnostic for the oracle-signer wiring (env-key or Privy). For each role it resolves
// the signer, signs a THROWAWAY message (no on-chain tx, no value moved), recovers the address, and
// reports only ADDRESSES + booleans — never a key or the Privy app secret. Use it after setting the
// Privy env to confirm the wiring BEFORE flipping anything that signs a real epoch.
//
// Auth: bearer-token (CRON_SECRET). ⚠ This only proves the app can sign as the Privy wallet; it does
// NOT prove the ON-CHAIN oracleSigner equals that address — you must still rotate the on-chain signer
// via the 48h timelock (see /api/admin/oracle/rotation + docs/developers/professional-key-setup.md).

import { recoverMessageAddress } from 'viem'
import { createHandler } from '@/lib/web2/routeHandler'
import { ADMIN_SECRET } from '@/lib/constants'
import { getOracleSigner } from '@/lib/web3/oracleSigner'
import type { OracleRole } from '@/lib/web3/oracleKeys'

export const dynamic = 'force-dynamic'

const ROLES: OracleRole[] = ['root', 'weight', 'range', 'agent']
const TEST_MESSAGE = 'mintware-oracle-signer-check'

type RoleReport =
  | {
      role: OracleRole
      ok: true
      address: string
      /** True if the signature recovers to the signer's own address (self-consistent). */
      recovers: boolean
      /** The <ROLE>_ORACLE_PRIVY_ADDRESS env value, when in Privy mode (else null). */
      expectedEnvAddress: string | null
      /** True if the signer address matches the declared env address (null when no env addr). */
      matchesExpected: boolean | null
    }
  | { role: OracleRole; ok: false; error: string }

async function checkRole(role: OracleRole): Promise<RoleReport> {
  try {
    const account   = await getOracleSigner(role)
    const signature = await account.signMessage({ message: TEST_MESSAGE })
    const recovered = await recoverMessageAddress({ message: TEST_MESSAGE, signature })
    const expected  = process.env[`${role.toUpperCase()}_ORACLE_PRIVY_ADDRESS`] || null
    return {
      role,
      ok: true,
      address: account.address,
      recovers: recovered.toLowerCase() === account.address.toLowerCase(),
      expectedEnvAddress: expected,
      matchesExpected: expected ? recovered.toLowerCase() === expected.toLowerCase() : null,
    }
  } catch (err) {
    return { role, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export const GET = createHandler(async (_req, ctx) => {
  const provider = (process.env.ORACLE_SIGNER_PROVIDER ?? 'env-key').toLowerCase()
  const roles = await Promise.all(ROLES.map(checkRole))
  return ctx.json({
    provider,
    roles,
    note:
      'Signature validity only. You must still rotate the ON-CHAIN oracleSigner to each address via ' +
      'the 48h timelock before Privy signing is accepted on-chain.',
  })
}, { auth: 'bearer-token', bearerSecret: ADMIN_SECRET })
