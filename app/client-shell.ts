import { net } from 'electron'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/** Slots in the shell HTML that the main process fills before serving it. */
const NONCE_SCRIPT_SLOT = '<!--sb:csp-nonce-script-->'
const HEAD_SCRIPTS_SLOT = '<!--sb:head-scripts-->'
const FONTS_SLOT = '<!--sb:fonts-->'

/**
 * Nonce placeholder, which only appears when the dev server produced the shell. Vite injects
 * inline scripts there (its client, the React Refresh preamble) and stamps them with this via its
 * `html.cspNonce` option. Build output has no inline content -- everything in it is an external
 * script or a modulepreload link that our CSP admits by origin -- so this matches nothing in a
 * packaged app. Must agree with `NONCE_TOKEN` in `vite.shared.ts`.
 */
const NONCE_TOKEN = '__SB_CSP_NONCE__'

/**
 * Every placeholder filled here, matched in one pass so that substitution order cannot matter.
 * Replacing sequentially would mean each later pattern scans text the earlier ones just inserted.
 */
const PLACEHOLDERS = [NONCE_TOKEN, NONCE_SCRIPT_SLOT, HEAD_SCRIPTS_SLOT, FONTS_SLOT]
const PLACEHOLDER_PATTERN = new RegExp(PLACEHOLDERS.map(escapeForRegExp).join('|'), 'g')

/** No placeholder above currently needs this; it's here so adding one can't quietly need it. */
function escapeForRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const BUILT_SHELL_PATH = path.join(__dirname, 'dist', 'index.html')

export interface ClientShellData {
  /** CSP nonce for this load, which every inline and injected tag must carry. */
  cspNonce: string
  analyticsId?: string
  /** URL of a running React DevTools standalone instance, if one should be connected to. */
  reactDevToolsUrl?: string
}

let cachedTemplate: string | undefined

/**
 * Reads the shell the client build produced.
 *
 * Cached, because the file only changes when a new build is installed, which means a new process.
 */
async function getBuiltShellTemplate(): Promise<string> {
  if (cachedTemplate === undefined) {
    try {
      cachedTemplate = await readFile(BUILT_SHELL_PATH, 'utf8')
    } catch (err) {
      // Nothing builds the client on demand, so a client started without a build fails here rather
      // than at launch. Say which step is missing; the bare ENOENT names a path that has never
      // existed and reads like a corrupt install.
      throw new Error(
        `Could not read the client shell at ${BUILT_SHELL_PATH}. Run ` +
          `\`pnpm run build-app-client\` to produce it.`,
        { cause: err },
      )
    }
  }

  return cachedTemplate
}

/**
 * Root-relative URL inside a double-quoted attribute or module specifier. See
 * {@link getDevShellTemplate} for why every one of them in the dev shell has to be rewritten.
 */
const ROOT_RELATIVE_URL = /"(\/[^/"][^"]*)"/g

/**
 * Fetches the shell from the Vite dev server, which returns it with the dev client, the React
 * Refresh preamble and the entry module injected.
 *
 * Those all arrive as root-relative URLs, which resolve against the *document* -- and this document
 * is served from `shieldbattery://app`, where none of them exist. `server.origin` does not cover
 * them: it applies to asset URLs generated from module code, not to what the HTML transform
 * injects, and Vite reduces an absolute `base` to its pathname when serving. So they get rewritten
 * here.
 *
 * Rewriting every root-relative URL in the document is correct because *every* one of them belongs
 * to the dev server: the shell's own URLs are rendered into it afterwards (see the fonts in
 * {@link renderClientShell}), which is why the shell source must not contain any of its own. Only
 * document-level URLs need this -- a root-relative specifier inside a module resolves against that
 * module's URL, which already points at the dev server.
 *
 * Never cached: the injected tags are what make HMR work at all, so they must not go stale.
 */
async function getDevShellTemplate(url: string, origin: string): Promise<string> {
  const response = await net.fetch(url)
  if (!response.ok) {
    throw new Error(`Dev server returned ${response.status} ${response.statusText} for ${url}`)
  }

  const html = await response.text()
  return html.replace(ROOT_RELATIVE_URL, (_match, urlPath: string) => `"${origin}${urlPath}"`)
}

export async function getClientShellTemplate(devServer?: {
  shellUrl: string
  origin: string
}): Promise<string> {
  return devServer
    ? await getDevShellTemplate(devServer.shellUrl, devServer.origin)
    : await getBuiltShellTemplate()
}

export function renderClientShell(template: string, data: ClientShellData): string {
  const { cspNonce, analyticsId, reactDevToolsUrl } = data
  const nonceAttr = ` nonce="${escapeAttribute(cspNonce)}"`

  // Read by client code (and by styled-components via `__webpack_nonce__`) to nonce the style and
  // script tags it injects at runtime, so it has to run before the entry module.
  const nonceScript =
    `<script type="text/javascript"${nonceAttr}>` +
    `window.SB_CSP_NONCE=${serializeForScript(cspNonce)}</script>`

  const headScripts = [
    reactDevToolsUrl
      ? `<script src="${escapeAttribute(reactDevToolsUrl)}"${nonceAttr}></script>`
      : '',
    analyticsId
      ? `<script type="text/javascript" defer${nonceAttr} ` +
        `src="https://cdn.usefathom.com/script.js" ` +
        `data-site="${escapeAttribute(analyticsId)}" data-auto="false"></script>`
      : '',
  ].join('')

  // Rendered here rather than left in the source HTML because Vite rewrites root-relative URLs in
  // the shell against its own base, which would point these at the script directory.
  const fonts = ['fonts/fonts.css', 'fonts/icons.css']
    .map(file => `<link href="/assets/${file}" rel="stylesheet" type="text/css"${nonceAttr}>`)
    .join('')

  const substitutions = new Map([
    [NONCE_TOKEN, escapeAttribute(cspNonce)],
    [NONCE_SCRIPT_SLOT, nonceScript],
    [HEAD_SCRIPTS_SLOT, headScripts],
    [FONTS_SLOT, fonts],
  ])

  return template.replace(PLACEHOLDER_PATTERN, match => substitutions.get(match) ?? match)
}

/** Escapes a value for use inside a double-quoted HTML attribute. */
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
 * the data from closing the script element early.
 */
function serializeForScript(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c')
}
