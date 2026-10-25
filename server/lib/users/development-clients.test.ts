import { afterEach, describe, expect, test, vi } from 'vitest'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { getDevelopmentClientUsers } from '../models/permissions'

vi.mock('../models/permissions', () => ({ getDevelopmentClientUsers: vi.fn() }))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  vi.resetAllMocks()
})

describe('development clients', () => {
  test.each(['staging', 'production'])('checks current account permissions in %s', async env => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SB_RP2_RELEASE_ENVIRONMENT', env)
    const { authorizeDevelopmentClients } = await import('./development-clients')
    const user = makeSbUserId(7)
    vi.mocked(getDevelopmentClientUsers).mockResolvedValue(new Set([user]))
    await expect(authorizeDevelopmentClients([user])).resolves.toBeUndefined()
    vi.mocked(getDevelopmentClientUsers).mockResolvedValue(new Set())
    await expect(authorizeDevelopmentClients([user])).rejects.toThrow('require permission')
    expect(getDevelopmentClientUsers).toHaveBeenCalledTimes(2)
  })

  test('ordinary clients need no permission query', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { authorizeDevelopmentClients } = await import('./development-clients')
    await authorizeDevelopmentClients([])
    expect(getDevelopmentClientUsers).not.toHaveBeenCalled()
  })

  test('contributors can use their local development server without the permission', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { authorizeDevelopmentClients } = await import('./development-clients')
    await authorizeDevelopmentClients([makeSbUserId(7)])
    expect(getDevelopmentClientUsers).not.toHaveBeenCalled()
  })

  test('rejects the batch if any requested account is unauthorized', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { authorizeDevelopmentClients } = await import('./development-clients')
    vi.mocked(getDevelopmentClientUsers).mockResolvedValue(new Set([makeSbUserId(7)]))
    await expect(authorizeDevelopmentClients([makeSbUserId(7), makeSbUserId(8)])).rejects.toThrow(
      'require permission',
    )
  })
})
