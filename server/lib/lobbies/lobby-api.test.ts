import { describe, expect, test } from 'vitest'
import { LobbyCreateErrorCode, LobbyJoinErrorCode } from '../../../common/lobbies/lobby-network'
import { convertLobbyServiceError } from './lobby-api'
import { LobbyServiceError, LobbyServiceErrorCode } from './lobby-service'

/**
 * The status and response-body code the client must receive for each service failure. This table is
 * the HTTP API's wire contract for lobby errors: a new `LobbyServiceErrorCode` fails to compile
 * until it's added here, and a mapping change fails the test until the table agrees.
 *
 * Failures without a client-facing create/join code carry their service code in the body instead.
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
  [LobbyServiceErrorCode.GameInProgress]: { status: 409 },
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
  [LobbyServiceErrorCode.NotHost]: { status: 403 },
  [LobbyServiceErrorCode.NotInLobby]: { status: 400 },
  [LobbyServiceErrorCode.NotObserverSlot]: { status: 400 },
  [LobbyServiceErrorCode.NotOwnSlot]: { status: 403 },
  [LobbyServiceErrorCode.NotSlotController]: { status: 403 },
  [LobbyServiceErrorCode.TargetNoActiveClient]: { status: 409 },
  [LobbyServiceErrorCode.UserOffline]: { status: 400 },
}

/**
 * Runs the converter over an error and returns whatever it threw, so a test can assert on the HTTP
 * status and the response body it would produce.
 */
function convert(err: unknown): any {
  try {
    convertLobbyServiceError(err)
  } catch (converted) {
    return converted
  }
  throw new Error('the converter returned without throwing')
}

describe('lobbies/lobby-api/convertLobbyServiceError', () => {
  test.each(Object.values(LobbyServiceErrorCode))('maps %s', code => {
    const expected = EXPECTED_ERROR_MAPPING[code]

    const converted = convert(new LobbyServiceError(code, 'test message'))

    expect(converted.status).toBe(expected.status)
    expect(converted.message).toBe('test message')
    expect(converted.payload).toEqual({ code: expected.bodyCode ?? code })
  })

  test('passes non-service errors through untouched', () => {
    const err = new Error('something else entirely')
    expect(convert(err)).toBe(err)
  })
})
