import { beforeEach, describe, expect, test, vi } from 'vitest'
import { asMockedFunction } from '../../common/testing/mocks'
import { SbUser } from '../../common/users/sb-user'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { DispatchFunction } from '../dispatch-registry'
import { fetchJson } from '../network/fetch'
import { RootState } from '../root-reducer'
import { findUserByName } from './action-creators'

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
