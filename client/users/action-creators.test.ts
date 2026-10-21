import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { asMockedFunction } from '../../common/testing/mocks'
import { SbUser } from '../../common/users/sb-user'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { UserErrorCode } from '../../common/users/user-network'
import { DispatchFunction } from '../dispatch-registry'
import { jotaiStore } from '../jotai-store'
import { fetchJson } from '../network/fetch'
import { FetchError } from '../network/fetch-errors'
import { RootState } from '../root-reducer'
import { AmbiguousUserNameError, findUserByName, findUserByTypedName } from './action-creators'
import { userAliasesAtom } from './user-aliases'

vi.mock('../network/fetch', () => ({
  fetchJson: vi.fn(),
  encodeBodyAsParams: vi.fn(() => ''),
}))

vi.mock('../logging/logger', () => ({
  default: { verbose: vi.fn(), debug: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

const fetchJsonMock = asMockedFunction(fetchJson)

const KNOWN_ID = makeSbUserId(1)
const FOUND_ID = makeSbUserId(2)

const knownUser: SbUser = { id: KNOWN_ID, name: 'Marko', created: 0 }
const foundUser: SbUser = { id: FOUND_ID, name: 'tec27', created: 0 }

/** Runs the thunk against a store that knows about `knownUser` and nobody else. */
function runFindUserByName(name: string) {
  const dispatched: unknown[] = []
  const dispatch = ((action: unknown) => {
    dispatched.push(action)
  }) as DispatchFunction<any>
  const onSuccess = vi.fn()
  const onError = vi.fn()

  findUserByName(name, { onSuccess, onError })(
    dispatch,
    () => ({ users: { byId: new Map([[KNOWN_ID, knownUser]]) } }) as unknown as RootState,
  )

  return { dispatched, onSuccess, onError }
}

describe('client/users/action-creators/findUserByName', () => {
  beforeEach(() => {
    fetchJsonMock.mockReset()
  })

  test('answers with a user the client already knows, without a request', async () => {
    const { dispatched, onSuccess } = runFindUserByName('mArKo')

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledWith(knownUser))
    expect(fetchJsonMock).not.toHaveBeenCalled()
    expect(dispatched).toEqual([])
  })

  test('looks an unknown name up and puts the user it finds in the store', async () => {
    fetchJsonMock.mockResolvedValue({ user: foundUser })

    const { dispatched, onSuccess } = runFindUserByName('tec27')

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledWith(foundUser))
    expect(fetchJsonMock).toHaveBeenCalledTimes(1)
    expect(fetchJsonMock.mock.calls[0][0]).toContain('users/by-name/tec27')
    expect(dispatched).toEqual([{ type: '@users/loadUsers', payload: [foundUser] }])
  })

  test('hands back the error a failed lookup carried', async () => {
    const error = new Error('no such user')
    fetchJsonMock.mockRejectedValue(error)

    const { dispatched, onError } = runFindUserByName('nobody')

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(error))
    expect(dispatched).toEqual([])
  })
})

describe('client/users/action-creators/findUserByTypedName', () => {
  const ALIASED_ID = makeSbUserId(3)
  const aliasedUser: SbUser = { id: ALIASED_ID, name: 'Bisu', created: 0 }

  function notFound() {
    return new FetchError(
      new Response('', { status: 404, statusText: 'Not Found' }),
      JSON.stringify({ code: UserErrorCode.NotFound }),
    )
  }

  function runFindUserByTypedName(name: string) {
    const dispatched: unknown[] = []
    const dispatch = ((action: unknown) => {
      dispatched.push(action)
    }) as DispatchFunction<any>
    const onSuccess = vi.fn()
    const onError = vi.fn()

    findUserByTypedName(name, { onSuccess, onError })(
      dispatch,
      () =>
        ({
          users: {
            byId: new Map([
              [KNOWN_ID, knownUser],
              [ALIASED_ID, aliasedUser],
            ]),
          },
        }) as unknown as RootState,
    )

    return { dispatched, onSuccess, onError }
  }

  beforeEach(() => {
    fetchJsonMock.mockReset()
    jotaiStore.set(userAliasesAtom, new Map([[ALIASED_ID, 'Boxer']]))
  })

  afterEach(() => {
    jotaiStore.set(userAliasesAtom, new Map())
  })

  test('resolves an alias to the player it was given to', async () => {
    fetchJsonMock.mockRejectedValue(notFound())

    const { onSuccess } = runFindUserByTypedName('boxer')

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledWith(aliasedUser))
  })

  test('prefers an exact original name over another account’s alias', async () => {
    const realBoxer: SbUser = { id: makeSbUserId(4), name: 'Boxer', created: 0 }
    fetchJsonMock.mockResolvedValue({ user: realBoxer })
    const { onSuccess, onError } = runFindUserByTypedName('Boxer')
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledWith(realBoxer))
    expect(onError).not.toHaveBeenCalled()
  })

  test('refuses an alias shared by several accounts, naming each of them', async () => {
    const otherAccount: SbUser = { id: makeSbUserId(5), name: 'Stork', created: 0 }
    jotaiStore.set(
      userAliasesAtom,
      new Map([
        [ALIASED_ID, 'Boxer'],
        [otherAccount.id, 'Boxer'],
      ]),
    )
    fetchJsonMock.mockImplementation(async (url: string) => {
      if (url.includes('by-name')) {
        throw notFound()
      }
      return { userInfos: [otherAccount] }
    })

    const { dispatched, onError } = runFindUserByTypedName('Boxer')

    await vi.waitFor(() => expect(onError).toHaveBeenCalled())
    const error = onError.mock.calls[0][0]
    expect(error).toBeInstanceOf(AmbiguousUserNameError)
    expect(error.candidates).toEqual([aliasedUser, otherAccount])
    // Only the account the client didn't know yet was requested.
    expect(fetchJsonMock.mock.calls[1][0]).toContain('users/batch-info?u=5')
    expect(dispatched).toContainEqual({ type: '@users/loadUsers', payload: [otherAccount] })
  })

  test('resolves an alias to the account actually named that when it’s the same player', async () => {
    fetchJsonMock.mockResolvedValue({ user: aliasedUser })
    jotaiStore.set(userAliasesAtom, new Map([[ALIASED_ID, 'bisu']]))

    const { onSuccess } = runFindUserByTypedName('bisu')

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledWith(aliasedUser))
  })

  test('still resolves the aliased player by their actual name', async () => {
    const { onSuccess } = runFindUserByTypedName('Bisu')

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledWith(aliasedUser))
    expect(fetchJsonMock).not.toHaveBeenCalled()
  })

  test('looks up names that are no alias like any other name', async () => {
    const { onSuccess } = runFindUserByTypedName('marko')

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledWith(knownUser))
  })
})
