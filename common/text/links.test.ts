import { describe, expect, test } from 'vitest'
import { matchLinks } from './links'

function doMatch(text: string): string[] {
  return Array.from(matchLinks(text), match => match.text)
}

describe('common/text/links/matchLinks', () => {
  test('link as entire text', () => {
    expect(doMatch('http://example.org/')).toMatchInlineSnapshot(`
      [
        "http://example.org/",
      ]
    `)
  })

  test('link as beginning text', () => {
    expect(doMatch('http://example.org/ is a link')).toMatchInlineSnapshot(`
      [
        "http://example.org/",
      ]
    `)
  })

  test('link as ending text', () => {
    expect(doMatch('here is a link http://example.org/')).toMatchInlineSnapshot(`
      [
        "http://example.org/",
      ]
    `)
  })

  test('link as middle text', () => {
    expect(doMatch('here is a link http://example.org/ okay')).toMatchInlineSnapshot(`
      [
        "http://example.org/",
      ]
    `)
  })

  test('link without path', () => {
    expect(doMatch('http://example.org')).toMatchInlineSnapshot(`
      [
        "http://example.org",
      ]
    `)
  })

  test('link with hex escaping', () => {
    expect(doMatch('http://www.google.com/#file%20one%26two')).toMatchInlineSnapshot(`
      [
        "http://www.google.com/#file%20one%26two",
      ]
    `)
  })

  test('link with https', () => {
    expect(doMatch('https://www.google.com/test')).toMatchInlineSnapshot(`
      [
        "https://www.google.com/test",
      ]
    `)
  })

  test('link with empty query', () => {
    expect(doMatch('https://www.google.com/?')).toMatchInlineSnapshot(`
      [
        "https://www.google.com/?",
      ]
    `)
  })

  test('link with query values', () => {
    expect(doMatch('https://www.google.com/?test=true&array%5B%5D=15&array%5B%5D=23'))
      .toMatchInlineSnapshot(`
      [
        "https://www.google.com/?test=true&array%5B%5D=15&array%5B%5D=23",
      ]
    `)
  })

  test('link ending in question mark', () => {
    expect(doMatch('http://www.google.com/?foo=bar?')).toMatchInlineSnapshot(`
      [
        "http://www.google.com/?foo=bar?",
      ]
    `)
  })

  test('link with query with a +', () => {
    expect(doMatch('http://www.google.com/?foo+bar')).toMatchInlineSnapshot(`
      [
        "http://www.google.com/?foo+bar",
      ]
    `)
  })

  test('link with hex escaping in path', () => {
    expect(doMatch('http://www.google.com/test%20path?query')).toMatchInlineSnapshot(`
      [
        "http://www.google.com/test%20path?query",
      ]
    `)
  })

  test('link with hash and query', () => {
    expect(doMatch('http://www.google.com/path?query#hash%20escaped')).toMatchInlineSnapshot(`
      [
        "http://www.google.com/path?query#hash%20escaped",
      ]
    `)
  })

  test('link with mixed case', () => {
    expect(doMatch('htTpS://WWW.example.ORG/path')).toMatchInlineSnapshot(`
      [
        "htTpS://WWW.example.ORG/path",
      ]
    `)
  })

  test('link with ipv4 address', () => {
    expect(doMatch('http://192.168.0.1')).toMatchInlineSnapshot(`
      [
        "http://192.168.0.1",
      ]
    `)
  })

  test('link with ip address and port', () => {
    expect(doMatch('http://192.168.0.1:9999')).toMatchInlineSnapshot(`
      [
        "http://192.168.0.1:9999",
      ]
    `)
  })

  test('link with host and port', () => {
    expect(doMatch('https://example.org:9999')).toMatchInlineSnapshot(`
      [
        "https://example.org:9999",
      ]
    `)
  })

  test('link with percent encoded host', () => {
    expect(doMatch('http://hello.%e4%b8%96%e7%95%8c.com/foo')).toMatchInlineSnapshot(`
      [
        "http://hello.%e4%b8%96%e7%95%8c.com/foo",
      ]
    `)
  })

  test('link with path beginning with /', () => {
    expect(doMatch('http://example.org//foo')).toMatchInlineSnapshot(`
      [
        "http://example.org//foo",
      ]
    `)
  })

  test('multiple links in text', () => {
    expect(doMatch('hello http://example.org/ world https://shieldbattery.net foo'))
      .toMatchInlineSnapshot(`
      [
        "http://example.org/",
        "https://shieldbattery.net",
      ]
    `)
  })

  test('link in parentheses', () => {
    expect(doMatch('hello (http://example.org/) world')).toMatchInlineSnapshot(`
      [
        "http://example.org/",
      ]
    `)
  })

  test('link with balanced parentheses in path', () => {
    expect(doMatch('see http://en.wikipedia.org/wiki/Bracket_(disambiguation) here'))
      .toMatchInlineSnapshot(`
      [
        "http://en.wikipedia.org/wiki/Bracket_(disambiguation)",
      ]
    `)
  })

  test('link in parentheses followed by a sentence-ending period', () => {
    expect(doMatch('hello (http://example.org/foo).')).toEqual(['http://example.org/foo'])
  })

  test('link in parentheses followed by an exclamation mark', () => {
    expect(doMatch('(http://example.org/foo)!')).toEqual(['http://example.org/foo'])
  })

  test('link with balanced parens in path, wrapped in parens, followed by a period', () => {
    expect(doMatch('see (http://example.org/wiki/Foo_(bar)).')).toEqual([
      'http://example.org/wiki/Foo_(bar)',
    ])
  })

  test('link followed by a sentence-ending period with no surrounding parens', () => {
    expect(doMatch('http://example.org/foo.')).toEqual(['http://example.org/foo'])
  })

  test('a whole trailing ellipsis is stripped', () => {
    expect(doMatch('http://example.org/foo...')).toEqual(['http://example.org/foo'])
  })

  test('trailing exclamation marks are stripped', () => {
    expect(doMatch('wow http://example.org/foo!!')).toEqual(['http://example.org/foo'])
  })

  test('mixed trailing sentence punctuation is stripped', () => {
    expect(doMatch('wow http://example.org/foo!.')).toEqual(['http://example.org/foo'])
  })

  test('a question mark stops the trailing-punctuation strip', () => {
    expect(doMatch('huh http://example.org/foo?!')).toEqual(['http://example.org/foo?'])
  })

  test('a period before the closing paren of a wrapping parenthetical stays', () => {
    expect(doMatch('(see http://example.org/foo.)')).toEqual(['http://example.org/foo.'])
  })

  test('text after an unbalanced closing paren is never part of the link', () => {
    expect(doMatch('(http://example.org/foo)..')).toEqual(['http://example.org/foo'])
  })

  test('link with adversarial paren-heavy input does not hang and matches correctly', () => {
    // A large run of unmatched opening parens preceding the URL, and a large run of unmatched
    // closing parens trailing it. This shape used to trigger quadratic backtracking in a
    // backreference-in-lookbehind regex; here it should just resolve to the plain URL.
    const openParens = '('.repeat(5000)
    const closeParens = ')'.repeat(5000)
    const text = `${openParens}http://example.org/foo${closeParens} trailing text`

    expect(doMatch(text)).toEqual(['http://example.org/foo'])
  })

  test('link with many balanced parens in path does not hang and matches correctly', () => {
    const pairs = '(a)'.repeat(5000)
    const text = `http://example.org/${pairs}`

    expect(doMatch(text)).toEqual([text])
  })

  /* eslint-disable-next-line vitest/no-commented-out-tests */
  /* TODO(tec27): Fix these, they're broken

  test('link with host subcomponent, ipv6 RFC 3986', () => {
    expect(doMatch('https://[fe80::1]')).toMatchInlineSnapshot(`
      Array [
        "https://[fe80::1]",
      ]
    `)
  })

  test('link with host subcomponent and port, ipv6 RFC 3986', () => {
    expect(doMatch('https://[fe80::1]:9999')).toMatchInlineSnapshot(`
      Array [
        "https://[fe80::1]:9999",
      ]
    `)
  })

  test('link with host subcomponent, zone identifier, ipv6 RFC 6874', () => {
    expect(doMatch('http://[fe80::1%25en0]')).toMatchInlineSnapshot(`
      Array [
        "http://[fe80::1%25en0]",
      ]
    `)
  })

  test('link with host subcomponent, zone identifier, port ipv6 RFC 6874', () => {
    expect(doMatch('http://[fe80::1%25en0]:9999')).toMatchInlineSnapshot(`
      Array [
        "http://[fe80::1%25en0]:9999",
      ]
    `)
  })

  test('link with host subcomponent, unreserved zone identifier, port ipv6 RFC 6874', () => {
    expect(doMatch('http://[fe80::1%25%65%6e%301-._~]:9999/')).toMatchInlineSnapshot(`
      Array [
        "http://[fe80::1%25%65%6e%301-._~]:9999/",
      ]
    `)
  })

  */
})
