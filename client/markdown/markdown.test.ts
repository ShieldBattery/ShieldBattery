import { describe, expect, test } from 'vitest'
import { collectImgSrcs, HastElement, isTrustedMediaUrl } from './markdown'

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

describe('collectImgSrcs', () => {
  function element(
    tagName: string,
    properties: Record<string, unknown>,
    children: HastElement['children'] = [],
  ): HastElement {
    return { type: 'element', tagName, properties, children } as HastElement
  }

  test('collects the src of a direct img child', () => {
    const anchor = element('a', { href: 'https://example.com' }, [
      element('img', { src: 'https://cdn.example.com/a.png' }),
    ])

    expect(collectImgSrcs(anchor)).toEqual(['https://cdn.example.com/a.png'])
  })

  test('collects the src of an img nested under emphasis', () => {
    const anchor = element('a', { href: 'https://example.com' }, [
      element('em', {}, [element('img', { src: 'https://cdn.example.com/a.png' })]),
    ])

    expect(collectImgSrcs(anchor)).toEqual(['https://cdn.example.com/a.png'])
  })

  test('collects multiple imgs across nesting levels, in document order', () => {
    const anchor = element('a', { href: 'https://example.com' }, [
      element('img', { src: 'https://cdn.example.com/a.png' }),
      { type: 'text', value: 'between' },
      element('strong', {}, [element('img', { src: 'https://evil.com/b.png' })]),
    ])

    expect(collectImgSrcs(anchor)).toEqual([
      'https://cdn.example.com/a.png',
      'https://evil.com/b.png',
    ])
  })

  test('returns an empty array when the subtree has no imgs', () => {
    const anchor = element('a', { href: 'https://example.com' }, [
      { type: 'text', value: 'just a link' },
      element('em', {}, [{ type: 'text', value: 'emphasized' }]),
    ])

    expect(collectImgSrcs(anchor)).toEqual([])
  })

  test('skips an img with missing properties without crashing', () => {
    const img = { type: 'element', tagName: 'img', children: [] } as unknown as HastElement
    const anchor = element('a', { href: 'https://example.com' }, [img])

    expect(collectImgSrcs(anchor)).toEqual([])
  })

  test('skips an img whose src is not a string', () => {
    const anchor = element('a', {}, [element('img', { src: 42 })])

    expect(collectImgSrcs(anchor)).toEqual([])
  })
})
