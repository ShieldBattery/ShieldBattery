import { describe, expect, test } from 'vitest'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { getChannelRole } from './channel-role'

const OWNER_ID = makeSbUserId(1)
const MODERATOR_ID = makeSbUserId(2)
const MEMBER_ID = makeSbUserId(3)

describe('client/chat/channel-role/getChannelRole', () => {
  test('reports the channel owner as the owner', () => {
    expect(getChannelRole(OWNER_ID, new Set([MODERATOR_ID]), OWNER_ID)).toBe('owner')
  })

  test('reports a member holding a moderation permission as a moderator', () => {
    expect(getChannelRole(OWNER_ID, new Set([MODERATOR_ID]), MODERATOR_ID)).toBe('moderator')
  })

  test('reports an owner who also holds moderation permissions as the owner', () => {
    expect(getChannelRole(OWNER_ID, new Set([OWNER_ID, MODERATOR_ID]), OWNER_ID)).toBe('owner')
  })

  test('reports no role for a member of a channel whose roles are unknown', () => {
    expect(getChannelRole(undefined, undefined, MODERATOR_ID)).toBeUndefined()
  })

  test('reports no role for an ordinary member', () => {
    expect(getChannelRole(OWNER_ID, new Set([MODERATOR_ID]), MEMBER_ID)).toBeUndefined()
  })

  test('reports no owner for a channel that has none', () => {
    expect(getChannelRole(undefined, new Set([MODERATOR_ID]), MEMBER_ID)).toBeUndefined()
  })
})
