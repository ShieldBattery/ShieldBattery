import { describe, expect, test } from 'vitest'
import { PageMetadata } from '../../../common/page-metadata'
import { ClientShellData, renderClientShell } from './client-shell'

/** Stands in for what the client build emits: the same slots, and tags carrying no nonce. */
const TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta name="color-scheme" content="only dark" />
    <!--sb:preconnect-->
    <!--sb:csp-nonce-script-->
    <!--sb:head-scripts-->
    <!--sb:meta-tags-->
    <!--sb:fonts-->
    <script type="module" crossorigin src="/scripts/index.abc123.js"></script>
    <link rel="modulepreload" crossorigin href="/scripts/vendor.def456.chunk.js">
  </head>
  <body><div id="app"></div></body>
</html>`

const PAGE_META: PageMetadata = {
  url: 'https://shieldbattery.net/users/1',
  type: 'website',
  title: 'A Player',
  description: 'A player profile.',
  image: 'https://shieldbattery.net/images/logo.png',
}

function render(overrides: Partial<ClientShellData> = {}): string {
  return renderClientShell(TEMPLATE, {
    cspNonce: 'test-nonce-value',
    initData: { serverConfig: {} },
    pageMeta: PAGE_META,
    publicAssetsUrl: 'https://shieldbattery.net/',
    version: '1.2.3',
    ...overrides,
  })
}

describe('server/lib/client-shell/renderClientShell', () => {
  test('nonces the inline scripts it renders, and only those', () => {
    const html = render({ analyticsId: 'ANALYTICS', deepLinkScheme: 'shieldbattery' })

    // The build's own tags are external and admitted by origin, so they get no nonce.
    expect(html).toContain('<script type="module" crossorigin src=')
    expect(html).toContain('<link rel="modulepreload"')

    expect(html).toContain('window.SB_CSP_NONCE="test-nonce-value"')
    for (const script of html.match(/<script[^>]*>/g) ?? []) {
      const isInline = !script.includes(' src=')
      // The analytics script is external but from an origin our CSP doesn't list, so it needs one.
      const needsNonce = isInline || script.includes('usefathom.com')
      expect(script.includes('nonce="test-nonce-value"')).toBe(needsNonce)
    }
  })

  test('rewrites built asset URLs to the public assets URL', () => {
    const html = render({ publicAssetsUrl: 'https://cdn.example.com/public/' })

    expect(html).toContain('src="https://cdn.example.com/public/scripts/index.abc123.js"')
    expect(html).toContain('href="https://cdn.example.com/public/scripts/vendor.def456.chunk.js"')
    expect(html).not.toContain('"/scripts/')
  })

  test('escapes user-controlled page metadata', () => {
    const html = render({
      pageMeta: {
        ...PAGE_META,
        title: '"><script>alert(1)</script>',
        description: "Bobby </title><img src=x onerror='alert(1)'>",
      },
    })

    // What matters is that no `<` from the metadata survives to open a tag; the inert text of an
    // attribute value (`onerror=&#39;...&#39;`) is harmless and does still appear.
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&quot;&gt;&lt;script&gt;')
    expect(html).toContain('&lt;img src=x')
  })

  test('keeps init data from breaking out of its script tag', () => {
    const html = render({ initData: { name: '</script><script>alert(1)</script>' } })

    // Escaping `<` alone is enough: a tag can't start without one.
    expect(html).not.toContain('</script><script>alert(1)')
    expect(html).toContain('\\u003c/script>\\u003cscript>alert(1)')
    // Still valid JSON once the escapes are resolved by the JS parser.
    const body = html.match(/window\._sbInitData=(.*?)<\/script>/)?.[1]
    expect(JSON.parse(body!.replaceAll('\\u003c', '<'))).toEqual({
      name: '</script><script>alert(1)</script>',
    })
  })

  test('treats replacement values literally, not as substitution patterns', () => {
    // `$&`, `` $` ``, `$'` and `$$` are meaningful to String.replace. User names legally contain
    // `$`, `` ` `` and `&`, so these must survive verbatim rather than splicing in the template.
    const hostile = "$`$'$&$$"
    const html = render({
      pageMeta: { ...PAGE_META, title: hostile },
      initData: { name: hostile },
    })

    // HTML-escaped, but note the escaped form still contains `$&` — escaping cannot defuse these,
    // which is the whole point.
    expect(html).toContain('content="$`$&#39;$&amp;$$"')
    expect(html).toContain(JSON.stringify(hostile).slice(1, -1))
    // A spliced template would duplicate the entry script tag.
    expect(html.match(/index\.abc123\.js/g)).toHaveLength(1)
    expect(html).toContain('<div id="app"></div>')
  })

  test('does not substitute the nonce into user-controlled content', () => {
    // The token is letters and underscores, which user names allow, so a user could set their
    // name to it. Substituting after the slots are filled would leak the request's nonce.
    const html = render({ pageMeta: { ...PAGE_META, title: '__SB_CSP_NONCE__' } })

    expect(html).toContain('content="__SB_CSP_NONCE__"')
    expect(html).not.toContain('content="test-nonce-value"')
  })

  test('never rescans substituted content for other placeholders', () => {
    // Values that happen to look like placeholders must survive. `"/scripts/` in particular has no
    // `<` for escaping to catch, and appears verbatim in any JSON string starting with /scripts/.
    const html = render({
      initData: { path: '/scripts/evil.js', marker: '<!--sb:fonts-->' },
      pageMeta: { ...PAGE_META, title: '<!--sb:meta-tags-->' },
    })

    expect(html).toContain('"/scripts/evil.js"')
    expect(html).not.toContain('https://shieldbattery.net/scripts/evil.js')
    // The real placeholders were still filled exactly once each.
    expect(html).not.toContain('<!--sb:')
    expect(html.match(/rel="stylesheet"/g)).toHaveLength(2)
  })

  test('omits optional blocks when their inputs are absent', () => {
    const html = render({
      initData: undefined,
      analyticsId: undefined,
      assetsOrigin: undefined,
      deepLinkScheme: undefined,
    })

    expect(html).not.toContain('_sbInitData')
    expect(html).not.toContain('usefathom.com')
    expect(html).not.toContain('preconnect')
    expect(html).not.toContain('SB_DEEP_LINK_SCHEME')
  })

  test('renders the optional blocks when their inputs are present', () => {
    const html = render({
      analyticsId: 'ANALYTICS',
      assetsOrigin: 'https://cdn.example.com',
      deepLinkScheme: 'shieldbattery',
      pageMeta: { ...PAGE_META, noindex: true, cardType: 'summary' },
    })

    expect(html).toContain('<link rel="preconnect" href="https://cdn.example.com">')
    expect(html).toContain('data-site="ANALYTICS"')
    expect(html).toContain('<meta name="robots" content="noindex"')
    expect(html).toContain('<meta name="twitter:card" content="summary"')
    expect(html).toContain('window.SB_DEEP_LINK_SCHEME="shieldbattery"')
  })

  test('cache-busts the font stylesheets with the app version', () => {
    const html = render({ version: '9.9.9' })

    expect(html).toContain('href="https://shieldbattery.net/fonts/fonts.css?9.9.9"')
    expect(html).toContain('href="https://shieldbattery.net/fonts/icons.css?9.9.9"')
  })
})
