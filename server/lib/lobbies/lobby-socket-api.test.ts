import { describe, expect, test } from 'vitest'
import { LobbyCreateErrorCode, LobbyJoinErrorCode } from '../../../common/lobbies/lobby-network'
import { LobbyServiceError, LobbyServiceErrorCode } from './lobby-service'
import { convertLobbyServiceError } from './lobby-socket-api'

/**
 * The status and error-body code the client must receive for each service failure. This table is
 * the websocket API's wire contract for lobby errors: a new `LobbyServiceErrorCode` fails to
 * compile until it's added here, and a mapping change fails the test until the table agrees.
 */
const EXPECTED_ERROR_MAPPING: Record<
  LobbyServiceErrorCode,
  { status: number; bodyCode?: LobbyCreateErrorCode | LobbyJoinErrorCode }
> = {
  [LobbyServiceErrorCode.AlreadyInActivity]: { status: 409 },
  [LobbyServiceErrorCode.AlreadyInSlot]: { status: 409 },
  [LobbyServiceErrorCode.AlreadyStarted]: { status: 409 },
  [LobbyServiceErrorCode.Banned]: { status: 409, bodyCode: LobbyJoinErrorCode.Banned },
  [LobbyServiceErrorCode.ChatRestricted]: { status: 403 },
  [LobbyServiceErrorCode.ComputerInObserverSlot]: { status: 400 },
  [LobbyServiceErrorCode.CountingDown]: { status: 409 },
  [LobbyServiceErrorCode.ForcedRace]: { status: 403 },
  [LobbyServiceErrorCode.InvalidGameSubType]: { status: 400 },
  [LobbyServiceErrorCode.InvalidGameType]: { status: 400 },
  [LobbyServiceErrorCode.InvalidMap]: { status: 400 },
  [LobbyServiceErrorCode.InvalidSlotId]: { status: 400 },
  [LobbyServiceErrorCode.InvalidSlotOperation]: { status: 400 },
  [LobbyServiceErrorCode.InvalidSlotType]: { status: 400 },
  [LobbyServiceErrorCode.JoinAlreadyInActivity]: {
    status: 409,
    bodyCode: LobbyJoinErrorCode.AlreadyInActivity,
  },
  [LobbyServiceErrorCode.JoinAlreadyStarted]: {
    status: 409,
    bodyCode: LobbyJoinErrorCode.AlreadyStarted,
  },
  [LobbyServiceErrorCode.LobbyFull]: { status: 409, bodyCode: LobbyJoinErrorCode.Full },
  [LobbyServiceErrorCode.NameTaken]: { status: 409, bodyCode: LobbyCreateErrorCode.NameTaken },
  [LobbyServiceErrorCode.NoActiveClient]: { status: 400 },
  [LobbyServiceErrorCode.NoLobby]: { status: 404, bodyCode: LobbyJoinErrorCode.NoLongerOpen },
  [LobbyServiceErrorCode.NotEnoughSides]: { status: 400 },
  [LobbyServiceErrorCode.NotHost]: { status: 401 },
  [LobbyServiceErrorCode.NotInLobby]: { status: 400 },
  [LobbyServiceErrorCode.NotObserverSlot]: { status: 400 },
  [LobbyServiceErrorCode.NotOwnSlot]: { status: 403 },
  [LobbyServiceErrorCode.NotSlotController]: { status: 403 },
  [LobbyServiceErrorCode.TargetNoActiveClient]: { status: 409 },
  [LobbyServiceErrorCode.UserOffline]: { status: 400 },
}

describe('lobbies/lobby-socket-api/convertLobbyServiceError', () => {
  test.each(Object.values(LobbyServiceErrorCode))('maps %s', code => {
    const expected = EXPECTED_ERROR_MAPPING[code]

    let thrown: any
    try {
      convertLobbyServiceError(new LobbyServiceError(code, 'test message'))
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeDefined()
    expect(thrown.status).toBe(expected.status)
    expect(thrown.message).toBe('test message')
    expect(thrown.body).toEqual(
      expected.bodyCode !== undefined ? { code: expected.bodyCode } : undefined,
    )
  })

  test('passes a non-service error through untouched', () => {
    const cause = new Error('not a service error')

    let thrown: unknown
    try {
      convertLobbyServiceError(cause)
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBe(cause)
  })
})
