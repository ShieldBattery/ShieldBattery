import got from 'got'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { asMockedFunction } from '../../../common/testing/mocks'
import { checkSessionsAlive } from './netcode-v2-service'

vi.mock('got', () => ({
  default: {
    post: vi.fn(),
  },
}))

/** Stubs netcode v2 as configured (coordinator URL + tenant), as `loadConfigFromEnv` expects. */
function configureNetcodeV2() {
  vi.stubEnv('SB_RP2_COORDINATOR_URL', 'http://coordinator.example')
  vi.stubEnv('SB_RP2_TENANT', 'sb-dev')
}

describe('netcode-v2/checkSessionsAlive', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  test('throws when netcode v2 is not configured', async () => {
    await expect(checkSessionsAlive([1, 2, 3])).rejects.toThrow('netcode v2 is not configured')
    expect(got.post).not.toHaveBeenCalled()
  })

  test('returns an empty set without a network call for an empty session list', async () => {
    configureNetcodeV2()

    const result = await checkSessionsAlive([])

    expect(result).toEqual(new Set())
    expect(got.post).not.toHaveBeenCalled()
  })

  test('posts the tenant + full session list and returns the alive set', async () => {
    configureNetcodeV2()
    const json = vi.fn().mockResolvedValue({ alive: [1, 3] })
    asMockedFunction(got.post).mockReturnValue({ json } as any)

    const result = await checkSessionsAlive([1, 2, 3])

    expect(got.post).toHaveBeenCalledWith(
      'http://coordinator.example/sessions/alive',
      expect.objectContaining({ json: { tenant: 'sb-dev', sessions: [1, 2, 3] } }),
    )
    expect(result).toEqual(new Set([1, 3]))
  })

  test('omits a session the coordinator did not report as alive', async () => {
    configureNetcodeV2()
    const json = vi.fn().mockResolvedValue({ alive: [1] })
    asMockedFunction(got.post).mockReturnValue({ json } as any)

    const result = await checkSessionsAlive([1, 2])

    expect(result.has(2)).toBe(false)
  })

  test('chunks requests at the batch size and merges the alive sets', async () => {
    configureNetcodeV2()
    const sessions = Array.from({ length: 600 }, (_, i) => i)
    const json = vi
      .fn()
      .mockResolvedValueOnce({ alive: [0] })
      .mockResolvedValueOnce({ alive: [512] })
    asMockedFunction(got.post).mockReturnValue({ json } as any)

    const result = await checkSessionsAlive(sessions)

    expect(got.post).toHaveBeenCalledTimes(2)
    const firstChunk = asMockedFunction(got.post).mock.calls[0][1] as any
    const secondChunk = asMockedFunction(got.post).mock.calls[1][1] as any
    expect(firstChunk.json.sessions).toHaveLength(512)
    expect(secondChunk.json.sessions).toHaveLength(88)
    expect(result).toEqual(new Set([0, 512]))
  })

  test('propagates a request failure', async () => {
    configureNetcodeV2()
    asMockedFunction(got.post).mockImplementation(() => {
      throw new Error('coordinator down')
    })

    await expect(checkSessionsAlive([1])).rejects.toThrow('coordinator down')
  })
})
