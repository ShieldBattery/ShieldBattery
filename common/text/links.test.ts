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

  test('link with internationalized host', () => {
    expect(doMatch('see http://例子.测试/ here')).toEqual(['http://例子.测试/'])
  })

  test('link with non-ascii path', () => {
    expect(doMatch('https://ko.wikipedia.org/wiki/스타크래프트')).toEqual([
      'https://ko.wikipedia.org/wiki/스타크래프트',
    ])
  })

  test('link with single-character labels', () => {
    expect(doMatch('https://x.com/foo and https://t.co/bar')).toEqual([
      'https://x.com/foo',
      'https://t.co/bar',
    ])
  })

  test('link with punycode TLD', () => {
    expect(doMatch('http://example.xn--p1ai/')).toEqual(['http://example.xn--p1ai/'])
  })

  test('link to localhost', () => {
    expect(doMatch('http://localhost:5555/chat')).toEqual(['http://localhost:5555/chat'])
  })

  test('link in angle brackets', () => {
    expect(doMatch('<http://www.example.com>')).toEqual(['http://www.example.com'])
  })

  test('link with path in angle brackets followed by a period', () => {
    expect(doMatch('see <http://example.com/a>.')).toEqual(['http://example.com/a'])
  })

  test('link in angle brackets inside parentheses', () => {
    expect(doMatch('(<http://example.com>)')).toEqual(['http://example.com'])
  })

  test('host ends at a character that cannot be part of it', () => {
    expect(doMatch('http://example.com, http://example.org_foo')).toEqual([
      'http://example.com',
      'http://example.org',
    ])
  })

  test('host followed by a sentence-ending period', () => {
    expect(doMatch('go to http://example.com.')).toEqual(['http://example.com'])
  })

  test('link with an invalid port keeps the host', () => {
    expect(doMatch('http://example.com:abc')).toEqual(['http://example.com'])
  })

  test('invalid hosts are not links', () => {
    expect(
      doMatch(
        [
          'http://exa<mple>.com/x',
          'http://-a-.com',
          'http://a-.com',
          'http://..../',
          'http://.example.com',
          'http://a..com',
          'http://example.c',
          'http://example.123',
          'http://example',
          'http://1.2.3',
          'http://1.2.3.256',
          'http://user@example.com',
          `http://${'a'.repeat(64)}.com`,
          'http://hello.%e4%b8%96%e7%95%8c.com/foo',
        ].join(' '),
      ),
    ).toEqual([])
  })

  test('a label of 63 characters is allowed', () => {
    const host = `${'a'.repeat(63)}.com`
    expect(doMatch(`http://${host}`)).toEqual([`http://${host}`])
  })

  test('a link after an invalid one is still found', () => {
    expect(doMatch('http://-bad-.com then http://example.org/')).toEqual(['http://example.org/'])
  })

  test('long run of host characters without a valid host does not hang', () => {
    const text = `http://${'a-'.repeat(50000)}`
    expect(doMatch(text)).toEqual([])
  })

  test('long run of dots after a host does not hang', () => {
    const text = `http://example.com${'.'.repeat(50000)}x`
    expect(doMatch(text)).toEqual([])
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

  test('link with ipv6 address', () => {
    expect(doMatch('https://[fe80::1]')).toEqual(['https://[fe80::1]'])
  })

  test('link with ipv6 address and port', () => {
    expect(doMatch('https://[fe80::1]:9999')).toEqual(['https://[fe80::1]:9999'])
  })

  test('link with ipv6 address, port and path', () => {
    expect(doMatch('see http://[2001:db8::1]:8080/a?b=c#d here')).toEqual([
      'http://[2001:db8::1]:8080/a?b=c#d',
    ])
  })

  test('link with ipv6 address followed by sentence punctuation', () => {
    expect(doMatch('(go to http://[::1].)')).toEqual(['http://[::1]'])
  })

  test('valid ipv6 addresses link and parse as URLs', () => {
    const links = [
      'http://[::]',
      'http://[::1]',
      'http://[1::]',
      'http://[2001:DB8::A]',
      'http://[2001:db8:0:0:0:0:0:1]',
      'http://[1:2:3:4:5:6:7::]',
      'http://[::2:3:4:5:6:7:8]',
      'http://[::ffff:192.0.2.1]',
      'http://[1:2:3:4:5:6:0.0.0.0]',
      'http://[ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255]',
    ]
    expect(doMatch(links.join(' '))).toEqual(links)
    for (const link of links) {
      expect(() => new URL(link)).not.toThrow()
    }
  })

  test('invalid ipv6 addresses are not links', () => {
    expect(
      doMatch(
        [
          'http://[]',
          'http://[:]',
          'http://[fe80::1',
          'http://[zzz::1]',
          'http://[1:2:3:4:5:6:7:8:9]',
          'http://[1:2:3:4:5:6:7]',
          'http://[1:2:3:4:5:6:7:8::]',
          'http://[1::2::3]',
          'http://[12345::1]',
          'http://[:1::2]',
          'http://[1::2:]',
          'http://[::1.2.3]',
          'http://[::1.2.3.256]',
          'http://[::01.2.3.4]',
          'http://[1.2.3.4::]',
          'http://[::1.2.3.4:5]',
          'http://[1:2:3:4:5:6:7:1.2.3.4]',
          'http://[192.168.0.1]',
        ].join(' '),
      ),
    ).toEqual([])
  })

  test('ipv6 addresses with a zone identifier are not links', () => {
    expect(
      doMatch(
        [
          'http://[fe80::1%25en0]',
          'http://[fe80::1%25en0]:9999',
          'http://[fe80::1%25%65%6e%301-._~]:9999/',
        ].join(' '),
      ),
    ).toEqual([])
  })

  test('long run of ipv6 characters without a closing bracket does not hang', () => {
    const text = `http://[${'1:'.repeat(50000)}`
    expect(doMatch(text)).toEqual([])
  })
})
