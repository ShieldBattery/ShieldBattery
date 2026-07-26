import { describe, expect, test } from 'vitest'
import { ChannelPermissions, SbChannelId, makeSbChannelId } from '../../common/chat'
import { SbUserId, makeSbUserId } from '../../common/users/sb-user-id'
import { RootState } from '../root-reducer'
import { ChannelLeaveSeverity, getChannelLeaveSeverity } from './action-creators'

const CHANNEL_ID = makeSbChannelId(1)
const SELF_ID = makeSbUserId(1)
const OTHER_ID = makeSbUserId(2)

const NO_PERMISSIONS: ChannelPermissions = {
  kick: false,
  ban: false,
  changeTopic: false,
  togglePrivate: false,
  editPermissions: false,
}

function makeState({
  official = false,
  userCount,
  ownerId,
  selfPermissions,
}: {
  official?: boolean
  /** When left `undefined`, the detailed channel info is absent entirely (not yet loaded). */
  userCount?: number
  ownerId?: SbUserId
  selfPermissions?: ChannelPermissions
} = {}): RootState {
  const chat = {
    idToBasicInfo: new Map([
      [CHANNEL_ID, { id: CHANNEL_ID, name: 'test', private: false, official }],
    ]),
    idToDetailedInfo: new Map(
      userCount !== undefined ? [[CHANNEL_ID, { id: CHANNEL_ID, userCount }]] : [],
    ),
    idToJoinedInfo: new Map([[CHANNEL_ID, { id: CHANNEL_ID, ownerId }]]),
    idToSelfPermissions: new Map<SbChannelId, ChannelPermissions>(
      selfPermissions ? [[CHANNEL_ID, selfPermissions]] : [],
    ),
  }
  return { chat } as unknown as RootState
}

describe('chat/action-creators/getChannelLeaveSeverity', () => {
  test('returns None when there is nothing at stake', () => {
    const state = makeState({ userCount: 5, ownerId: OTHER_ID, selfPermissions: NO_PERMISSIONS })

    expect(getChannelLeaveSeverity(state, CHANNEL_ID, SELF_ID)).toBe(ChannelLeaveSeverity.None)
  })

  test('returns LosePermissions when holding any channel permission', () => {
    const state = makeState({
      userCount: 5,
      ownerId: OTHER_ID,
      selfPermissions: { ...NO_PERMISSIONS, kick: true },
    })

    expect(getChannelLeaveSeverity(state, CHANNEL_ID, SELF_ID)).toBe(
      ChannelLeaveSeverity.LosePermissions,
    )
  })

  test('returns LoseOwnership for an owner who is not the last member, even with permissions', () => {
    const state = makeState({
      userCount: 5,
      ownerId: SELF_ID,
      selfPermissions: {
        kick: true,
        ban: true,
        changeTopic: true,
        togglePrivate: true,
        editPermissions: true,
      },
    })

    expect(getChannelLeaveSeverity(state, CHANNEL_ID, SELF_ID)).toBe(
      ChannelLeaveSeverity.LoseOwnership,
    )
  })

  test('returns DeleteChannel for the last member of a non-official channel', () => {
    const state = makeState({ userCount: 1 })

    expect(getChannelLeaveSeverity(state, CHANNEL_ID, SELF_ID)).toBe(
      ChannelLeaveSeverity.DeleteChannel,
    )
  })

  test('returns DeleteChannel (not LoseOwnership) for an owner who is also the last member', () => {
    const state = makeState({ userCount: 1, ownerId: SELF_ID })

    expect(getChannelLeaveSeverity(state, CHANNEL_ID, SELF_ID)).toBe(
      ChannelLeaveSeverity.DeleteChannel,
    )
  })

  test('never claims deletion when the member count is missing', () => {
    expect(getChannelLeaveSeverity(makeState({ ownerId: SELF_ID }), CHANNEL_ID, SELF_ID)).toBe(
      ChannelLeaveSeverity.LoseOwnership,
    )
    expect(getChannelLeaveSeverity(makeState(), CHANNEL_ID, SELF_ID)).toBe(
      ChannelLeaveSeverity.None,
    )
  })

  test('never claims deletion for official channels, falling through to lesser severities', () => {
    expect(
      getChannelLeaveSeverity(makeState({ official: true, userCount: 1 }), CHANNEL_ID, SELF_ID),
    ).toBe(ChannelLeaveSeverity.None)
    expect(
      getChannelLeaveSeverity(
        makeState({
          official: true,
          userCount: 1,
          selfPermissions: { ...NO_PERMISSIONS, changeTopic: true },
        }),
        CHANNEL_ID,
        SELF_ID,
      ),
    ).toBe(ChannelLeaveSeverity.LosePermissions)
  })
})
