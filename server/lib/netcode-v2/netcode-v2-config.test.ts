import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { loadConfigFromEnv } from './netcode-v2-config'

describe('netcode v2 evidence configuration', () => {
  beforeEach(() => {
    vi.stubEnv('SB_RP2_COORDINATOR_URL', 'http://coordinator.example')
    vi.stubEnv('SB_RP2_TENANT', 'sb-dev')
    vi.stubEnv('SB_RP2_CLIENT_KEY', '11'.repeat(32))
    vi.stubEnv('SB_RP2_EVIDENCE_KEYS', undefined)
  })
  afterEach(() => vi.unstubAllEnvs())

  test('omits keys when unconfigured or empty', () => {
    expect(loadConfigFromEnv()).not.toHaveProperty('evidenceKeys')
    vi.stubEnv('SB_RP2_EVIDENCE_KEYS', '[]')
    expect(loadConfigFromEnv()).not.toHaveProperty('evidenceKeys')
  })

  test('accepts rotating verification keys including u32 boundary IDs', () => {
    const keys = [
      { keyId: 0, publicKey: 'ab'.repeat(32) },
      { keyId: 0xffffffff, publicKey: 'CD'.repeat(32) },
    ]
    vi.stubEnv('SB_RP2_EVIDENCE_KEYS', JSON.stringify(keys))
    expect(loadConfigFromEnv()?.evidenceKeys).toEqual(keys)
  })

  test.each([
    '',
    'null',
    '{}',
    '[',
    JSON.stringify([{ keyId: -1, publicKey: 'ab'.repeat(32) }]),
    JSON.stringify([{ keyId: 0x100000000, publicKey: 'ab'.repeat(32) }]),
    JSON.stringify([{ keyId: 1.5, publicKey: 'ab'.repeat(32) }]),
    JSON.stringify([{ keyId: '1', publicKey: 'ab'.repeat(32) }]),
    JSON.stringify([{ keyId: 1, publicKey: 'ab'.repeat(31) }]),
    JSON.stringify([{ keyId: 1, publicKey: 'zz'.repeat(32) }]),
    JSON.stringify([{ publicKey: 'ab'.repeat(32) }]),
    JSON.stringify([{ keyId: 1 }]),
    JSON.stringify(Array.from({ length: 2 }, () => ({ keyId: 1, publicKey: 'ab'.repeat(32) }))),
    JSON.stringify(
      Array.from({ length: 17 }, (_, keyId) => ({ keyId, publicKey: 'ab'.repeat(32) })),
    ),
  ])('rejects malformed keys: %s', value => {
    vi.stubEnv('SB_RP2_EVIDENCE_KEYS', value)
    expect(loadConfigFromEnv).toThrow('SB_RP2_EVIDENCE_KEYS')
  })

  test('validates supplied keys even when coordinator access is disabled', () => {
    vi.stubEnv('SB_RP2_COORDINATOR_URL', undefined)
    vi.stubEnv('SB_RP2_EVIDENCE_KEYS', 'bad')
    expect(loadConfigFromEnv).toThrow('SB_RP2_EVIDENCE_KEYS')
  })
})
