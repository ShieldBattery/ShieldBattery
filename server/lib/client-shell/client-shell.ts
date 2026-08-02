import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PageMetadata } from '../../../common/page-metadata'

/** Slots in the shell HTML that the server fills per request. */
const PRECONNECT_SLOT = '<!--sb:preconnect-->'
const NONCE_SCRIPT_SLOT = '<!--sb:csp-nonce-script-->'
const HEAD_SCRIPTS_SLOT = '<!--sb:head-scripts-->'
const META_TAGS_SLOT = '<!--sb:meta-tags-->'
const FONTS_SLOT = '<!--sb:fonts-->'

/**
 * Nonce placeholder, which only appears when the dev server produced the shell. Vite injects
 * inline scripts there (its client, the React Refresh preamble) and stamps them with this via its
 * `html.cspNonce` option. Build output has no inline content -- everything in it is an external
 * script or stylesheet that our CSP admits by origin -- so this matches nothing in production.
 */
const NONCE_TOKEN = '__SB_CSP_NONCE__'

/**
 * Prefix the client build writes asset URLs with. Rewritten per request because the public assets
 * URL is deployment configuration (it may point at a CDN) and so isn't known at build time. Only
 * the URLs in the shell need this: lazily imported chunks are resolved by the browser relative to
 * the module that imports them, which already came from the right origin.
 */
const BUILT_ASSET_PREFIX = '"/scripts/'

const SHELL_PATH = path.join(__dirname, '..', '..', 'client-shell', 'index.html')

export interface ClientShellData {
  /** CSP nonce for this request, which every inline and injected tag must carry. */
  cspNonce: string
  /** Bootstrap state serialized into `window._sbInitData`. Contains session info. */
  initData: unknown
  pageMeta: PageMetadata
  /** Base URL public assets are served from. Always ends in a slash. */
  publicAssetsUrl: string
  /** Origin to preconnect to when assets are served from somewhere other than this host. */
  assetsOrigin?: string
  analyticsId?: string
  /** Used to cache-bust the font stylesheets, which aren't content-hashed. */
  version: string
}

let cachedTemplate: string | undefined
let templateSource: ((url: string) => Promise<string>) | undefined

/**
 * Overrides where the shell comes from. The dev server uses this to serve the *source* HTML with
 * Vite's client and refresh preamble injected, instead of a build output that doesn't exist yet.
 */
export function setShellTemplateSource(source: (url: string) => Promise<string>): void {
  templateSource = source
}

/**
 * Reads the shell the client build produced. Cached, because the file only changes when a new
 * build is deployed, which means a new process.
 */
export async function getClientShellTemplate(url: string): Promise<string> {
  if (templateSource) {
    return await templateSource(url)
  }
  if (cachedTemplate === undefined) {
    cachedTemplate = await readFile(SHELL_PATH, 'utf8')
  }
  return cachedTemplate
}

export function renderClientShell(template: string, data: ClientShellData): string {
  const { cspNonce, initData, pageMeta, publicAssetsUrl, assetsOrigin, analyticsId, version } = data
  const nonceAttr = ` nonce="${escapeAttribute(cspNonce)}"`

  const preconnect = assetsOrigin
    ? `<link rel="preconnect" href="${escapeAttribute(assetsOrigin)}">` +
      `<link rel="preconnect" href="${escapeAttribute(assetsOrigin)}" crossorigin>`
    : ''

  // Read by client code (and by styled-components via `__webpack_nonce__`) to nonce the style and
  // script tags it injects at runtime, so it has to run before the entry module.
  const nonceScript =
    `<script type="text/javascript"${nonceAttr}>` +
    `window.SB_CSP_NONCE=${serializeForScript(cspNonce)}</script>`

  const headScripts = [
    initData
      ? `<script type="text/javascript"${nonceAttr}>` +
        `window._sbInitData=${serializeForScript(initData)}</script>`
      : '',
    analyticsId
      ? `<script type="text/javascript" defer${nonceAttr} ` +
        `src="https://cdn.usefathom.com/script.js" ` +
        `data-site="${escapeAttribute(analyticsId)}" data-auto="false"></script>`
      : '',
  ].join('')

  // Rendered here rather than left in the source HTML because Vite rewrites root-relative URLs
  // in the shell against its own base, which would point this at the script directory.
  const favicon = `<link rel="icon" type="image/x-icon" href="/images/favicon.ico">`

  const fonts = [`fonts/fonts.css`, `fonts/icons.css`]
    .map(
      file =>
        `<link href="${escapeAttribute(`${publicAssetsUrl}${file}?${version}`)}" ` +
        `rel="stylesheet" type="text/css"${nonceAttr}>`,
    )
    .join('')

  // Every replacement is a function so its value is taken literally. As a plain string, `$&`,
  // `` $` ``, `$'` and `$$` are substitution patterns -- and user names legally contain `$`,
  // `` ` `` and `&` (`USERNAME_ALLOWED_CHARACTERS`), so a name like `` $` `` would otherwise
  // splice part of the surrounding template into the page. Escaping cannot fix this; the
  // characters are meaningful to `replace` itself, not to HTML.
  return template
    .replaceAll(BUILT_ASSET_PREFIX, () => `"${publicAssetsUrl}scripts/`)
    .replace(PRECONNECT_SLOT, () => preconnect)
    .replace(NONCE_SCRIPT_SLOT, () => nonceScript)
    .replace(HEAD_SCRIPTS_SLOT, () => headScripts)
    .replace(META_TAGS_SLOT, () => renderPageMetaTags(pageMeta))
    .replace(FONTS_SLOT, () => favicon + fonts)
    .replaceAll(NONCE_TOKEN, () => escapeAttribute(cspNonce))
}

function renderPageMetaTags(pageMeta: PageMetadata): string {
  const tags: Array<[attribute: 'property' | 'name', key: string, value: string | undefined]> = [
    ['name', 'robots', pageMeta.noindex ? 'noindex' : undefined],
    ['property', 'og:url', pageMeta.url],
    ['property', 'og:type', pageMeta.type],
    ['property', 'og:title', pageMeta.title],
    ['property', 'og:description', pageMeta.description],
    ['property', 'og:image', pageMeta.image],
    ['property', 'article:published_time', pageMeta.publishedTime],
    ['name', 'twitter:card', pageMeta.cardType ?? 'summary_large_image'],
    ['name', 'twitter:title', pageMeta.title],
    ['name', 'twitter:site', '@ShieldBatteryBW'],
    ['name', 'twitter:description', pageMeta.description],
    ['name', 'twitter:image', pageMeta.image],
  ]

  return tags
    .filter(([, , value]) => value !== undefined)
    .map(
      ([attribute, key, value]) =>
        `<meta ${attribute}="${key}" content="${escapeAttribute(value!)}" ` +
        `data-react-helmet="true">`,
    )
    .join('')
}

/**
 * Escapes a value for use inside a double-quoted HTML attribute. Page metadata carries
 * user-controlled text (user names, map names, news titles), so this is load-bearing rather than
 * defensive.
 */
function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * Serializes a value for embedding in an inline `<script>`. Escaping `<` is what stops a string in
 * the data from closing the script element early. The two line separators are escaped as cheap
 * insurance: they are legal inside a JSON string but were line terminators in JavaScript source
 * until the JSON-superset change, so an engine predating it would see a broken script.
 */
function serializeForScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}
