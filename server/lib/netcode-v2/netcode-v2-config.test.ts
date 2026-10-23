import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { loadConfigFromEnv } from './netcode-v2-config'

describe('netcode v2 coordinator configuration', () => {
  beforeEach(() => {
    vi.stubEnv('SB_RP2_COORDINATOR_URL', 'http://coordinator.example')
    vi.stubEnv('SB_RP2_TENANT', 'sb-dev')
    vi.stubEnv('SB_RP2_CLIENT_KEY', '11'.repeat(32))
    vi.stubEnv('SB_RP2_RELAY_SERVER_NAME', undefined)
    vi.stubEnv('SB_RP2_ROLLBACK', undefined)
    vi.stubEnv('SB_RP2_PERIODIC_EVIDENCE', undefined)
    vi.stubEnv('SB_RP2_RELEASE_CATALOG', undefined)
  })
  afterEach(() => vi.unstubAllEnvs())

  test('disables coordinator access when no URL is configured', () => {
    vi.stubEnv('SB_RP2_COORDINATOR_URL', undefined)
    expect(loadConfigFromEnv()).toBeUndefined()
  })

  test('loads transport configuration with explicit rollback opt-in', () => {
    expect(loadConfigFromEnv()).toEqual({
      periodicEvidence: false,
      coordinatorUrl: 'http://coordinator.example',
      tenant: 'sb-dev',
      relayServerName: 'localhost',
      rollback: false,
    })
    vi.stubEnv('SB_RP2_RELAY_SERVER_NAME', 'relay.example')
    vi.stubEnv('SB_RP2_ROLLBACK', 'true')
    expect(loadConfigFromEnv()).toMatchObject({ relayServerName: 'relay.example', rollback: true })
  })

  test('requires a catalog for explicit periodic collection', () => {
    vi.stubEnv('SB_RP2_PERIODIC_EVIDENCE', 'true')
    expect(loadConfigFromEnv).toThrow('requires SB_RP2_RELEASE_CATALOG')
    vi.stubEnv('SB_RP2_RELEASE_CATALOG', 'releases/current.json')
    expect(loadConfigFromEnv()?.periodicEvidence).toBe(true)
  })

  test.each([
    ['SB_RP2_TENANT', undefined],
    ['SB_RP2_CLIENT_KEY', undefined],
    ['SB_RP2_CLIENT_KEY', 'invalid'],
  ])('rejects invalid %s', (name, value) => {
    vi.stubEnv(name, value)
    expect(loadConfigFromEnv).toThrow(name)
  })
})
