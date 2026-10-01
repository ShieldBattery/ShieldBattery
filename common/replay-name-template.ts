/**
 * A template for the filename of a game's auto-saved replay: literal text interleaved with
 * `{token}` placeholders, e.g. `[SB]{time}-{map}`. The game DLL fills the tokens in when SC:R
 * copies the finished replay into its `AutoSave` folder; the parsing and rendering here mirror the
 * DLL's (`game/src/replay_name.rs`) so the settings page can preview a template.
 */

export const ALL_REPLAY_NAME_TOKENS = [
  'date',
  'time',
  'map',
  'name',
  'opponents',
  'race',
  'opponentRaces',
  'format',
  'matchup',
] as const

export type ReplayNameToken = (typeof ALL_REPLAY_NAME_TOKENS)[number]

export function isReplayNameToken(value: unknown): value is ReplayNameToken {
  return ALL_REPLAY_NAME_TOKENS.includes(value as ReplayNameToken)
}

/** The name games have always been saved under, and the one a blank template falls back to. */
export const DEFAULT_REPLAY_NAME_TEMPLATE = '[SB]{time}-{map}'

export const MAX_REPLAY_NAME_TEMPLATE_LENGTH = 200

/**
 * Longest a rendered name gets (in characters, before `.rep` and any ` (2)` suffix), so the full
 * path stays well inside Windows' 260-character path limit.
 */
export const MAX_REPLAY_NAME_LENGTH = 100

export type ReplayNamePart =
  | { kind: 'token'; token: ReplayNameToken }
  | { kind: 'text'; text: string }

const TOKEN_PATTERN = /\{([A-Za-z]+)\}/g

/**
 * Splits a template into its parts. Braces that don't wrap a known token name are kept as literal
 * text (and later dropped by sanitization when rendered).
 */
export function parseReplayNameTemplate(template: string): ReplayNamePart[] {
  const parts: ReplayNamePart[] = []
  let text = ''
  let lastIndex = 0
  for (const match of template.matchAll(TOKEN_PATTERN)) {
    const name = match[1]
    if (!isReplayNameToken(name)) {
      continue
    }
    text += template.slice(lastIndex, match.index)
    if (text) {
      parts.push({ kind: 'text', text })
      text = ''
    }
    parts.push({ kind: 'token', token: name })
    lastIndex = match.index + match[0].length
  }
  text += template.slice(lastIndex)
  if (text) {
    parts.push({ kind: 'text', text })
  }
  return parts
}

export function serializeReplayNameTemplate(parts: ReadonlyArray<ReplayNamePart>): string {
  return parts.map(p => (p.kind === 'token' ? `{${p.token}}` : p.text)).join('')
}

/**
 * Removes the characters Windows doesn't allow in a filename (plus control characters, which
 * include StarCraft's color codes) and the braces that delimit tokens.
 */
export function sanitizeReplayNameText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x1F<>:"/\\|?*{}]/g, '')
}

/**
 * Fills in a template with the given token values, producing a filename without its extension.
 * The result is sanitized, cut to `MAX_REPLAY_NAME_LENGTH` and stripped of the trailing dots and
 * spaces Windows ignores; a template that renders to nothing falls back to the default template.
 */
export function renderReplayNameTemplate(
  template: string,
  values: Readonly<Record<ReplayNameToken, string>>,
): string {
  const render = (t: string) =>
    Array.from(
      parseReplayNameTemplate(t)
        .map(p => sanitizeReplayNameText(p.kind === 'token' ? values[p.token] : p.text))
        .join(''),
    )
      .slice(0, MAX_REPLAY_NAME_LENGTH)
      .join('')
      .replace(/[. ]+$/, '')
      .trim()

  return render(template) || render(DEFAULT_REPLAY_NAME_TEMPLATE)
}
