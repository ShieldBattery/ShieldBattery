import { describe, expect, test } from 'vitest'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { MESSAGE_LINK_PARAM } from '../messaging/message-link'
import {
  urlForWhisper,
  urlForWhisperMessage,
  urlForWhisperMessageLink,
  whisperMessageFromUrl,
} from './whisper-url'

const TARGET_ID = makeSbUserId(7)
const MESSAGE_ID = '9b2e8d0e-5f3a-4a2b-8c1d-6f5e4d3c2b1a'

describe('whispers/whisper-url', () => {
  describe('urlForWhisper', () => {
    test('builds a whisper URL', () => {
      expect(urlForWhisper(TARGET_ID, 'ShieldBattery')).toBe('/whispers/7/ShieldBattery')
    })

    test('encodes the target name', () => {
      expect(urlForWhisper(TARGET_ID, 'cool guys/gals')).toBe('/whispers/7/cool%20guys%2Fgals')
    })
  })

  describe('urlForWhisperMessageLink', () => {
    test('builds a viewer-independent message link', () => {
      expect(urlForWhisperMessageLink(MESSAGE_ID)).toBe(`/whispers/m/${MESSAGE_ID}`)
    })
  })

  describe('urlForWhisperMessage', () => {
    test('adds the message to the whisper URL', () => {
      expect(urlForWhisperMessage(TARGET_ID, 'ShieldBattery', MESSAGE_ID)).toBe(
        `/whispers/7/ShieldBattery?${MESSAGE_LINK_PARAM}=${MESSAGE_ID}`,
      )
    })

    test('reads back through URLSearchParams', () => {
      const url = urlForWhisperMessage(TARGET_ID, 'ShieldBattery', MESSAGE_ID)
      const search = new URLSearchParams(url.substring(url.indexOf('?')))

      expect(search.get(MESSAGE_LINK_PARAM)).toBe(MESSAGE_ID)
    })
  })

  describe('whisperMessageFromUrl', () => {
    test('round-trips a URL built by urlForWhisperMessageLink', () => {
      const path = urlForWhisperMessageLink(MESSAGE_ID)
      const url = new URL(path, 'https://example.org')

      expect(whisperMessageFromUrl(url)).toEqual({ messageId: MESSAGE_ID })
    })

    test('rejects a normal (viewer-relative) whisper URL', () => {
      const url = new URL(`/whispers/${TARGET_ID}/ShieldBattery`, 'https://example.org')

      expect(whisperMessageFromUrl(url)).toBeUndefined()
    })

    test('rejects a resolved whisper message URL', () => {
      const url = new URL(
        `/whispers/${TARGET_ID}/ShieldBattery?${MESSAGE_LINK_PARAM}=${MESSAGE_ID}`,
        'https://example.org',
      )

      expect(whisperMessageFromUrl(url)).toBeUndefined()
    })

    test('rejects a non-UUID message id', () => {
      const url = new URL('/whispers/m/not-a-uuid', 'https://example.org')

      expect(whisperMessageFromUrl(url)).toBeUndefined()
    })

    test('rejects extra path segments', () => {
      const url = new URL(`/whispers/m/${MESSAGE_ID}/extra`, 'https://example.org')

      expect(whisperMessageFromUrl(url)).toBeUndefined()
    })

    test('rejects a missing message id segment', () => {
      const url = new URL('/whispers/m', 'https://example.org')

      expect(whisperMessageFromUrl(url)).toBeUndefined()
    })
  })
})
