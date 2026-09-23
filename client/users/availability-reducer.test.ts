import { describe, expect, test } from 'vitest'
import { makeSbChannelId } from '../../common/chat'
import {
  AvailabilityInfo,
  DEFAULT_AVAILABILITY_INFO,
  UserAvailability,
} from '../../common/users/availability'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { ChatActions } from '../chat/actions'
import { UserActions } from './actions'
import reducerImport, { AvailabilityState } from './availability-reducer'

const reducer = reducerImport as unknown as (
  state: AvailabilityState | undefined,
  action: ChatActions | UserActions | { type: '@network/connect' },
) => AvailabilityState

const CHANNEL_ID = makeSbChannelId(1)
const USER_A = makeSbUserId(1)
const USER_B = makeSbUserId(2)
const AWAY: AvailabilityInfo = { availability: UserAvailability.Away, statusMessage: 'brb' }

function initialState(): AvailabilityState {
  return reducer(undefined, { type: '@network/connect' })
}

describe('users/availability-reducer', () => {
  test('gives active channel users without a listed availability the default', () => {
    const state = reducer(initialState(), {
      type: '@chat/initActiveUsers',
      payload: {
        action: 'initActiveUsers',
        activeUserIds: [USER_A, USER_B],
        availabilities: [{ userId: USER_B, ...AWAY }],
      },
      meta: { channelId: CHANNEL_ID },
    })

    expect(state.byUserId.get(USER_A)).toEqual(DEFAULT_AVAILABILITY_INFO)
    expect(state.byUserId.get(USER_B)).toEqual(AWAY)
  })

  test('replaces a stale value when a user comes back online with the default', () => {
    let state = reducer(initialState(), {
      type: '@users/updateFriendAvailability',
      payload: { userId: USER_A, info: AWAY },
    })
    state = reducer(state, {
      type: '@chat/updateUserActive',
      payload: { action: 'userActive2', userId: USER_A },
      meta: { channelId: CHANNEL_ID },
    })

    expect(state.byUserId.get(USER_A)).toEqual(DEFAULT_AVAILABILITY_INFO)
  })

  test('forgets a user that goes offline through either route', () => {
    let state = reducer(initialState(), {
      type: '@chat/updateUserAvailability',
      payload: { action: 'userAvailability', userId: USER_A, availability: AWAY },
      meta: { channelId: CHANNEL_ID },
    })
    state = reducer(state, {
      type: '@users/updateFriendAvailability',
      payload: { userId: USER_B, info: AWAY },
    })

    state = reducer(state, {
      type: '@chat/updateUserOffline',
      payload: { action: 'userOffline2', userId: USER_A },
      meta: { channelId: CHANNEL_ID },
    })
    state = reducer(state, {
      type: '@users/updateFriendAvailability',
      payload: { userId: USER_B, info: null },
    })

    expect(state.byUserId.size).toBe(0)
  })
})
