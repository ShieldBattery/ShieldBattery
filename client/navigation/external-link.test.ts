import { beforeEach, describe, expect, test } from 'vitest'
import { setServerConfig } from '../server-config-storage'
import { isSbContentUrl } from './external-link'

describe('isSbContentUrl', () => {
  describe('CDN-style public assets config', () => {
    beforeEach(() => {
      setServerConfig({
        publicAssetsUrl: 'https://cdn.shieldbattery.net/public/',
        graphqlOrigin: 'https://gql.shieldbattery.net/',
      })
    })

    test('returns true for an uploaded file at the CDN origin root', () => {
      expect(isSbContentUrl(new URL('https://cdn.shieldbattery.net/news/abc/video.mp4'))).toBe(true)
    })

    test('returns true for a public asset under the configured path', () => {
      expect(isSbContentUrl(new URL('https://cdn.shieldbattery.net/public/images/logo.svg'))).toBe(
        true,
      )
    })

    test('returns true for the server-origin file store', () => {
      expect(isSbContentUrl(new URL('https://shieldbattery.net/files/news/abc/img.png'))).toBe(true)
    })

    test('returns false for an app route on the server origin', () => {
      expect(isSbContentUrl(new URL('https://shieldbattery.net/ladder'))).toBe(false)
    })

    test('returns false when /files/ is not a whole path segment', () => {
      expect(isSbContentUrl(new URL('https://shieldbattery.net/files-extra/x.png'))).toBe(false)
    })

    test('returns false for a foreign origin', () => {
      expect(isSbContentUrl(new URL('https://example.com/files/x.png'))).toBe(false)
    })

    test('is case-insensitive on origin', () => {
      expect(isSbContentUrl(new URL('https://CDN.shieldbattery.net/x.mp4'))).toBe(true)
    })
  })

  describe('local-filesystem-style public assets config (same origin as server)', () => {
    beforeEach(() => {
      setServerConfig({
        publicAssetsUrl: 'https://shieldbattery.net/',
        graphqlOrigin: 'https://gql.shieldbattery.net/',
      })
    })

    test('returns true for the server-origin file store', () => {
      expect(isSbContentUrl(new URL('https://shieldbattery.net/files/news/abc/img.png'))).toBe(true)
    })

    test('returns false for an app route, even though the assets origin matches the server', () => {
      expect(isSbContentUrl(new URL('https://shieldbattery.net/ladder'))).toBe(false)
    })
  })
})
