import { beforeEach, describe, expect, test, vi } from 'vitest'
import { USERNAME_MAXLENGTH } from '../../../common/constants'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { SEARCH_USERS_LIMIT, UserErrorCode } from '../../../common/users/user-network'
import { UserApi } from './user-api'
import { convertUserApiErrors } from './user-api-errors'
import { findUserByName, findUsersByNamePrefix } from './user-model'

// The real module hashes `SB_CANONICAL_HOST` at import time, which isn't set outside a running
// server process and would otherwise crash merely importing `UserApi`.
vi.mock('../mail/mailer', () => ({ sendMailTemplate: vi.fn() }))

// UserApi's constructor resolves these jobs from the DI container, and the real ones reach for a
// database to schedule their periodic cleanup work, which isn't available in a unit test.
vi.mock('./password-reset-cleanup', () => ({ PasswordResetCleanupJob: class {} }))
vi.mock('./signup-code-cleanup', () => ({ SignupCodeCleanupJob: class {} }))
vi.mock('./user-identifier-cleanup', () => ({ UserIdentifierCleanupJob: class {} }))
vi.mock('./user-ips-cleanup', () => ({ UserIpsCleanupJob: class {} }))

vi.mock('./user-model', async importOriginal => ({
  ...(await importOriginal<typeof import('./user-model')>()),
  findUserByName: vi.fn(),
  findUsersByNamePrefix: vi.fn(),
}))

const findUserByNameMock = asMockedFunction(findUserByName)
const findUsersByNamePrefixMock = asMockedFunction(findUsersByNamePrefix)

function makeApi(): UserApi {
  return new UserApi(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  )
}

describe('users/user-api/UserApi#getUserByName', () => {
  beforeEach(() => {
    findUserByNameMock.mockReset()
  })

  test('resolves the user the model found for the name', async () => {
    const api = makeApi()
    const user = { id: makeSbUserId(7), name: 'tec27', created: 0 }
    findUserByNameMock.mockResolvedValue(user)

    // Same unmodified pass-through that the whisper endpoint (`POST /whispers/by-name/:targetName`)
    // does: both resolve a name to a user identically.
    const result = await api.getUserByName({ params: { name: 'tec27' } } as any)

    expect(result.user).toBe(user)
    expect(findUserByNameMock).toHaveBeenCalledTimes(1)
    expect(findUserByNameMock).toHaveBeenCalledWith('tec27')
  })

  test('answers not found when no user has that name', async () => {
    const api = makeApi()
    findUserByNameMock.mockResolvedValue(undefined)

    const err = await api.getUserByName({ params: { name: 'nobody' } } as any).catch(e => e)

    expect(err).toHaveProperty('code', UserErrorCode.NotFound)

    // convertUserApiErrors is what turns that error into a 404 response.
    const next = async () => {
      throw err
    }
    const converted = await convertUserApiErrors({} as any, next).catch(e => e)

    expect(converted).toHaveProperty('status', 404)
  })

  test('rejects a name that fails validation before looking it up', async () => {
    const api = makeApi()

    await expect(api.getUserByName({ params: { name: '' } } as any)).rejects.toThrow()
    expect(findUserByNameMock).not.toHaveBeenCalled()
  })
})

describe('users/user-api/UserApi#searchUsers', () => {
  beforeEach(() => {
    findUsersByNamePrefixMock.mockReset()
    findUsersByNamePrefixMock.mockResolvedValue([])
  })

  function search(q: unknown) {
    return makeApi().searchUsers({ request: { query: { q } } } as any)
  }

  test('searches for the trimmed text, capped at the search limit', async () => {
    const user = { id: makeSbUserId(7), name: 'tec27', created: 0 }
    findUsersByNamePrefixMock.mockResolvedValue([user])

    const result = await search('  tec  ')

    expect(result.users).toEqual([user])
    expect(findUsersByNamePrefixMock).toHaveBeenCalledWith('tec', SEARCH_USERS_LIMIT)
  })

  test('rejects a missing query before searching', async () => {
    await expect(search(undefined)).rejects.toThrow()
    expect(findUsersByNamePrefixMock).not.toHaveBeenCalled()
  })

  test('rejects a query that is empty once trimmed before searching', async () => {
    await expect(search('   ')).rejects.toThrow()
    expect(findUsersByNamePrefixMock).not.toHaveBeenCalled()
  })

  test('rejects a query longer than any username before searching', async () => {
    await expect(search('a'.repeat(USERNAME_MAXLENGTH + 1))).rejects.toThrow()
    expect(findUsersByNamePrefixMock).not.toHaveBeenCalled()
  })

  test('accepts a query as long as the longest username', async () => {
    await search('a'.repeat(USERNAME_MAXLENGTH))

    expect(findUsersByNamePrefixMock).toHaveBeenCalledWith(
      'a'.repeat(USERNAME_MAXLENGTH),
      SEARCH_USERS_LIMIT,
    )
  })
})
