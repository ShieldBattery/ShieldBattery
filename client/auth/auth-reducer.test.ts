import { describe, expect, test } from 'vitest'
import { SbPermissions } from '../../common/users/permissions'
import { RestrictionKind, RestrictionReason } from '../../common/users/restrictions'
import { SelfUserJson } from '../../common/users/sb-user'
import { makeSbUserId } from '../../common/users/sb-user-id'
import authReducer from './auth-reducer'

const USER = { id: makeSbUserId(1), name: 'user' } as SelfUserJson

function loggedInState() {
  return authReducer(undefined, {
    type: '@auth/loadCurrentSession',
    payload: { user: USER, permissions: {} as SbPermissions },
  } as any)
}

describe('client/auth/auth-reducer', () => {
  test('restrictionsChanged replaces the restrictions with the full set it carries', () => {
    let state = loggedInState()
    state = authReducer(state, {
      type: '@auth/restrictionsChanged',
      payload: {
        restrictions: [
          { kind: RestrictionKind.Chat, endTime: 2000, reason: RestrictionReason.Spam },
          { kind: RestrictionKind.Matchmaking, endTime: 3000 },
        ],
      },
    } as any)
    expect(Array.from(state.self!.restrictions.keys())).toEqual([
      RestrictionKind.Chat,
      RestrictionKind.Matchmaking,
    ])

    // A lift of the chat restriction sends the remaining set
    state = authReducer(state, {
      type: '@auth/restrictionsChanged',
      payload: { restrictions: [{ kind: RestrictionKind.Matchmaking, endTime: 3000 }] },
    } as any)
    expect(state.self!.restrictions.has(RestrictionKind.Chat)).toBe(false)
    expect(state.self!.restrictions.get(RestrictionKind.Matchmaking)).toEqual({
      kind: RestrictionKind.Matchmaking,
      endTime: 3000,
    })
  })
})
