import { describe, expect, test } from 'vitest'
import { isTrustedMediaUrl } from './markdown'

describe('isTrustedMediaUrl', () => {
  const trustedOrigin = 'https://cdn.example.com'

  test('returns true for an absolute URL on the trusted origin', () => {
    expect(isTrustedMediaUrl('https://cdn.example.com/public/foo.png', trustedOrigin)).toBe(true)
  })

  test('returns false for an absolute URL on a different origin', () => {
    expect(isTrustedMediaUrl('https://evil.com/foo.png', trustedOrigin)).toBe(false)
  })

  test('returns false for a relative path', () => {
    expect(isTrustedMediaUrl('/files/foo.png', trustedOrigin)).toBe(false)
  })

  test('returns false for a data: URL', () => {
    expect(isTrustedMediaUrl('data:image/png;base64,AAAA', trustedOrigin)).toBe(false)
  })

  test('returns false for unparseable garbage', () => {
    expect(isTrustedMediaUrl('https://', trustedOrigin)).toBe(false)
  })

  test('returns false for the same host but a different port', () => {
    expect(isTrustedMediaUrl('https://cdn.example.com:8443/foo.png', trustedOrigin)).toBe(false)
  })

  test('returns false for the same host but a different protocol', () => {
    expect(isTrustedMediaUrl('http://cdn.example.com/foo.png', trustedOrigin)).toBe(false)
  })
})
