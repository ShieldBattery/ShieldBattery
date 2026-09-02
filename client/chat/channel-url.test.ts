import { describe, expect, test } from 'vitest'
import { makeSbChannelId } from '../../common/chat'
import { MESSAGE_LINK_PARAM, urlForChannel, urlForChannelMessage } from './channel-url'

const CHANNEL_ID = makeSbChannelId(7)
const MESSAGE_ID = '9b2e8d0e-5f3a-4a2b-8c1d-6f5e4d3c2b1a'

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
})
