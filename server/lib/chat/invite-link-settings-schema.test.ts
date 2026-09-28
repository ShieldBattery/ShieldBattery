import { describe, expect, test } from 'vitest'
import {
  INVITE_LINK_EXPIRY_OPTIONS_SECONDS,
  INVITE_LINK_MAX_USES_OPTIONS,
} from '../../../common/chat'
import { createInviteLinkBodySchema } from './invite-link-settings-schema'

describe('chat/invite-link-settings-schema', () => {
  test('accepts an empty body', () => {
    const { error, value } = createInviteLinkBodySchema().validate({})

    expect(error).toBeUndefined()
    expect(value).toEqual({})
  })

  test('treats a missing body as an empty one', () => {
    const { error, value } = createInviteLinkBodySchema().validate(undefined)

    expect(error).toBeUndefined()
    expect(value).toEqual({})
  })

  test('accepts every offered expiry and use limit', () => {
    for (const expiresInSeconds of INVITE_LINK_EXPIRY_OPTIONS_SECONDS) {
      for (const maxUses of INVITE_LINK_MAX_USES_OPTIONS) {
        expect(
          createInviteLinkBodySchema().validate({ expiresInSeconds, maxUses }).error,
        ).toBeUndefined()
      }
    }
  })

  test('accepts null for a link that never expires and has no use limit', () => {
    const { error, value } = createInviteLinkBodySchema().validate({
      expiresInSeconds: null,
      maxUses: null,
    })

    expect(error).toBeUndefined()
    expect(value).toEqual({ expiresInSeconds: null, maxUses: null })
  })

  test('refuses an expiry that is not offered', () => {
    expect(createInviteLinkBodySchema().validate({ expiresInSeconds: 60 }).error).toBeDefined()
    expect(
      createInviteLinkBodySchema().validate({ expiresInSeconds: 365 * 24 * 60 * 60 }).error,
    ).toBeDefined()
    expect(createInviteLinkBodySchema().validate({ expiresInSeconds: -1800 }).error).toBeDefined()
  })

  test('refuses a use limit that is not offered', () => {
    expect(createInviteLinkBodySchema().validate({ maxUses: 0 }).error).toBeDefined()
    expect(createInviteLinkBodySchema().validate({ maxUses: 2 }).error).toBeDefined()
    expect(createInviteLinkBodySchema().validate({ maxUses: 1000 }).error).toBeDefined()
  })

  test('refuses unknown fields', () => {
    expect(createInviteLinkBodySchema().validate({ uses: 5 }).error).toBeDefined()
  })
})
