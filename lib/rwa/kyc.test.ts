import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import {
  verifyPersonaSignature,
  parsePersonaInquiry,
  decisionFromInquiry,
  providerHashFor,
  countryToBytes2,
} from './kyc'

const SECRET = 'whsec_test'
const WALLET = '0x1111111111111111111111111111111111111111'

function sign(rawBody: string, secret = SECRET, t = '1700000000'): string {
  const hmac = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')
  return `t=${t},v1=${hmac}`
}

function inquiry(status: string, referenceId = WALLET, country = 'US') {
  return {
    data: {
      attributes: {
        name: 'inquiry.completed',
        payload: {
          data: {
            id: 'inq_abc123',
            type: 'inquiry',
            attributes: { status, 'reference-id': referenceId, 'address-country-code': country },
          },
        },
      },
    },
  }
}

describe('verifyPersonaSignature', () => {
  it('accepts a correctly signed body', () => {
    const raw = JSON.stringify(inquiry('approved'))
    expect(verifyPersonaSignature(raw, sign(raw), SECRET)).toBe(true)
  })
  it('rejects a tampered body', () => {
    const raw = JSON.stringify(inquiry('approved'))
    const header = sign(raw)
    expect(verifyPersonaSignature(raw + ' ', header, SECRET)).toBe(false)
  })
  it('rejects a wrong secret', () => {
    const raw = JSON.stringify(inquiry('approved'))
    expect(verifyPersonaSignature(raw, sign(raw), 'nope')).toBe(false)
  })
  it('rejects missing header or empty secret', () => {
    const raw = JSON.stringify(inquiry('approved'))
    expect(verifyPersonaSignature(raw, null, SECRET)).toBe(false)
    expect(verifyPersonaSignature(raw, sign(raw), '')).toBe(false)
  })
})

describe('parse + decision', () => {
  it('approved inquiry → verified BASIC decision keyed by lowercased wallet', () => {
    const p = parsePersonaInquiry(inquiry('approved', WALLET.toUpperCase()))
    expect(p).not.toBeNull()
    const d = decisionFromInquiry(p!)
    expect(d).toMatchObject({ address: WALLET, status: 'verified', level: 1, countryCode: 'US', restricted: false })
    expect(d!.providerHash).toBe(providerHashFor('inq_abc123'))
  })
  it('declined inquiry → declined level 0', () => {
    const d = decisionFromInquiry(parsePersonaInquiry(inquiry('declined'))!)
    expect(d).toMatchObject({ status: 'declined', level: 0 })
  })
  it('non-terminal status → no decision', () => {
    expect(decisionFromInquiry(parsePersonaInquiry(inquiry('pending'))!)).toBeNull()
  })
  it('non-address reference-id → no decision', () => {
    expect(decisionFromInquiry(parsePersonaInquiry(inquiry('approved', 'not-an-address'))!)).toBeNull()
  })
  it('unrelated payload → null parse', () => {
    expect(parsePersonaInquiry({ hello: 'world' })).toBeNull()
  })
})

describe('encoders', () => {
  it('providerHashFor is deterministic keccak', () => {
    expect(providerHashFor('inq_abc123')).toBe(providerHashFor('inq_abc123'))
    expect(providerHashFor('inq_abc123')).not.toBe(providerHashFor('inq_xyz'))
  })
  it('countryToBytes2 encodes ISO code / falls back to 0x0000', () => {
    expect(countryToBytes2('US')).toBe('0x5553')
    expect(countryToBytes2('')).toBe('0x0000')
    expect(countryToBytes2('x')).toBe('0x0000')
  })
})
