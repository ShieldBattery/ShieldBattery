import { describe, expect, test } from 'vitest'
import { makeSbChannelId } from '../../common/chat'
import { encodePrettyId } from '../../common/pretty-id'
import { MESSAGE_LINK_PARAM } from '../messaging/message-link'
import {
  channelFromUrl,
  channelInviteTokenFromPath,
  channelMessageFromUrl,
  urlForChannel,
  urlForChannelInvite,
  urlForChannelMessage,
} from './channel-url'

const CHANNEL_ID = makeSbChannelId(7)
const MESSAGE_ID = '9b2e8d0e-5f3a-4a2b-8c1d-6f5e4d3c2b1a'
const INVITE_TOKEN = encodePrettyId('5eed0000-0000-4000-8000-000000000001')

describe('chat/channel-url', () => {
  describe('urlForChannel', () => {
    test('builds a channel URL', () => {
      expect(urlForChannel(CHANNEL_ID, 'ShieldBattery')).toBe('/chat/7/ShieldBattery')
    })

    test('encodes the channel name', () => {
      expect(urlForChannel(CHANNEL_ID, 'cool guys/gals')).toBe('/chat/7/cool%20guys%2Fgals')
    })

    test('uses a placeholder name when the name is unknown', () => {
      expect(urlForChannel(CHANNEL_ID, undefined)).toBe('/chat/7/_')
      expect(urlForChannel(CHANNEL_ID, '')).toBe('/chat/7/_')
    })
  })

  describe('urlForChannelMessage', () => {
    test('adds the message to the channel URL', () => {
      expect(urlForChannelMessage(CHANNEL_ID, 'ShieldBattery', MESSAGE_ID)).toBe(
        `/chat/7/ShieldBattery?${MESSAGE_LINK_PARAM}=${MESSAGE_ID}`,
      )
    })

    test('encodes the message id', () => {
      expect(urlForChannelMessage(CHANNEL_ID, 'ShieldBattery', 'a b&c')).toBe(
        `/chat/7/ShieldBattery?${MESSAGE_LINK_PARAM}=a+b%26c`,
      )
    })

    test('reads back through URLSearchParams', () => {
      const url = urlForChannelMessage(CHANNEL_ID, 'ShieldBattery', MESSAGE_ID)
      const search = new URLSearchParams(url.substring(url.indexOf('?')))

      expect(search.get(MESSAGE_LINK_PARAM)).toBe(MESSAGE_ID)
    })
  })

  describe('channelMessageFromUrl', () => {
    test('round-trips a URL built by urlForChannelMessage', () => {
      const path = urlForChannelMessage(CHANNEL_ID, 'ShieldBattery', MESSAGE_ID)
      const url = new URL(path, 'https://example.org')

      expect(channelMessageFromUrl(url)).toEqual({ channelId: CHANNEL_ID, messageId: MESSAGE_ID })
    })

    test('ignores the channel name segment', () => {
      const url = new URL(
        `/chat/7/some-other-name?${MESSAGE_LINK_PARAM}=${MESSAGE_ID}`,
        'https://example.org',
      )

      expect(channelMessageFromUrl(url)).toEqual({ channelId: CHANNEL_ID, messageId: MESSAGE_ID })
    })

    test('ignores the placeholder channel name segment', () => {
      const url = new URL(`/chat/7/_?${MESSAGE_LINK_PARAM}=${MESSAGE_ID}`, 'https://example.org')

      expect(channelMessageFromUrl(url)).toEqual({ channelId: CHANNEL_ID, messageId: MESSAGE_ID })
    })

    test('rejects a non-chat path', () => {
      const url = new URL(`/lobbies/7?${MESSAGE_LINK_PARAM}=${MESSAGE_ID}`, 'https://example.org')

      expect(channelMessageFromUrl(url)).toBeUndefined()
    })

    test('rejects a non-numeric channel id', () => {
      const url = new URL(
        `/chat/not-a-number/ShieldBattery?${MESSAGE_LINK_PARAM}=${MESSAGE_ID}`,
        'https://example.org',
      )

      expect(channelMessageFromUrl(url)).toBeUndefined()
    })

    test('rejects a missing message param', () => {
      const url = new URL('/chat/7/ShieldBattery', 'https://example.org')

      expect(channelMessageFromUrl(url)).toBeUndefined()
    })

    test('rejects a non-UUID message param', () => {
      const url = new URL(
        `/chat/7/ShieldBattery?${MESSAGE_LINK_PARAM}=not-a-uuid`,
        'https://example.org',
      )

      expect(channelMessageFromUrl(url)).toBeUndefined()
    })

    test('rejects an invite link', () => {
      const url = new URL(
        `/chat/invite/${INVITE_TOKEN}?${MESSAGE_LINK_PARAM}=${MESSAGE_ID}`,
        'https://example.org',
      )

      expect(channelMessageFromUrl(url)).toBeUndefined()
    })
  })

  describe('channelFromUrl', () => {
    test('round-trips a URL built by urlForChannel', () => {
      const url = new URL(urlForChannel(CHANNEL_ID, 'ShieldBattery'), 'https://example.org')
      expect(channelFromUrl(url)).toBe(CHANNEL_ID)
    })

    test('ignores the channel name segment, placeholder included', () => {
      expect(channelFromUrl(new URL('/chat/7/some-other-name', 'https://example.org'))).toBe(
        CHANNEL_ID,
      )
      expect(
        channelFromUrl(new URL(urlForChannel(CHANNEL_ID, undefined), 'https://example.org')),
      ).toBe(CHANNEL_ID)
    })

    test('accepts a trailing slash', () => {
      expect(channelFromUrl(new URL('/chat/7/ShieldBattery/', 'https://example.org'))).toBe(
        CHANNEL_ID,
      )
    })

    test('rejects a link to one of the channel messages', () => {
      const url = new URL(
        urlForChannelMessage(CHANNEL_ID, 'ShieldBattery', MESSAGE_ID),
        'https://example.org',
      )
      expect(channelFromUrl(url)).toBeUndefined()
    })

    test('rejects other chat paths', () => {
      for (const path of [
        '/chat',
        '/chat/7',
        '/chat/list',
        '/chat/new',
        '/chat/7/ShieldBattery/extra',
        '/chat/0/ShieldBattery',
        '/chat/-7/ShieldBattery',
        '/chat/7x/ShieldBattery',
        '/chat/99999999999999999999/ShieldBattery',
        `/chat/invite/${INVITE_TOKEN}`,
        '/chat/admin/7',
        '/users/7/ShieldBattery',
      ]) {
        expect(channelFromUrl(new URL(path, 'https://example.org'))).toBeUndefined()
      }
    })
  })

  describe('urlForChannelInvite', () => {
    test('builds an invite URL', () => {
      expect(urlForChannelInvite(INVITE_TOKEN)).toBe(`/chat/invite/${INVITE_TOKEN}`)
    })
  })

  describe('channelInviteTokenFromPath', () => {
    test('round-trips a URL built by urlForChannelInvite', () => {
      expect(channelInviteTokenFromPath(urlForChannelInvite(INVITE_TOKEN))).toBe(INVITE_TOKEN)
    })

    test('accepts a trailing slash', () => {
      expect(channelInviteTokenFromPath(`/chat/invite/${INVITE_TOKEN}/`)).toBe(INVITE_TOKEN)
    })

    test('rejects a token that is not shaped like one', () => {
      expect(channelInviteTokenFromPath('/chat/invite/not-a-token')).toBeUndefined()
      expect(channelInviteTokenFromPath(`/chat/invite/${INVITE_TOKEN}x`)).toBeUndefined()
    })

    test('rejects other chat paths', () => {
      expect(channelInviteTokenFromPath('/chat/invite')).toBeUndefined()
      expect(channelInviteTokenFromPath(`/chat/invite/${INVITE_TOKEN}/extra`)).toBeUndefined()
      expect(channelInviteTokenFromPath(`/chat/7/${INVITE_TOKEN}`)).toBeUndefined()
      expect(channelInviteTokenFromPath(`/lobbies/invite/${INVITE_TOKEN}`)).toBeUndefined()
    })
  })
})
