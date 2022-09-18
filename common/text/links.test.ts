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

  /* eslint-disable-next-line jest/no-commented-out-tests */
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
