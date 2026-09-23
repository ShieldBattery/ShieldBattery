/**
 * In-game names for bots. StarCraft shows these in the lobby, the game and the replay, and the
 * launch API only accepts 1-24 printable ASCII characters, so a bot's catalog name (or a name the
 * user typed) has to be reduced to that before it can be launched.
 */

const MAX_NAME_LENGTH = 24

/** Used when a name reduces to nothing at all. */
export const FALLBACK_BOT_NAME = 'Bot'

/** Reduces a name to the 1-24 printable ASCII characters the game accepts. */
export function sanitizeInGameName(name: string | undefined): string {
  const printable = Array.from(name ?? '')
    .filter(char => {
      const code = char.codePointAt(0)!
      return code >= 0x20 && code <= 0x7e
    })
    .join('')
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .trim()
  return printable.length ? printable : FALLBACK_BOT_NAME
}

/**
 * Sanitizes names and makes them distinct, since two slots sharing a name are indistinguishable in
 * the lobby and the replay. Later duplicates get a ` 2`, ` 3`... suffix, with the base trimmed so
 * the result still fits the length limit.
 */
export function dedupeInGameNames(names: Array<string | undefined>): string[] {
  const used = new Set<string>()
  return names.map(name => {
    const base = sanitizeInGameName(name)
    if (!used.has(base.toLowerCase())) {
      used.add(base.toLowerCase())
      return base
    }
    for (let suffixNumber = 2; ; suffixNumber++) {
      const suffix = ` ${suffixNumber}`
      const candidate = `${base.slice(0, MAX_NAME_LENGTH - suffix.length).trimEnd()}${suffix}`
      if (!used.has(candidate.toLowerCase())) {
        used.add(candidate.toLowerCase())
        return candidate
      }
    }
  })
}

export interface BotLaunchNameSource {
  /** The name shown in the game. It falls back to the real name for ordinary practice games. */
  inGameName?: string
  /** The bot's real identity, retained for replay metadata. */
  replayName?: string
}

export interface BotLaunchNames {
  inGameName: string
  replayName?: string
}

/**
 * Gives each bot independent in-game and replay names, reserving the human player's name in both
 * lists. A missing replay name stays missing so older direct local-game callers retain their
 * existing behavior.
 */
export function resolveBotLaunchNames(
  playerName: string | undefined,
  bots: ReadonlyArray<BotLaunchNameSource>,
): BotLaunchNames[] {
  const inGameNames = dedupeInGameNames([
    playerName,
    ...bots.map(bot => bot.inGameName ?? bot.replayName),
  ]).slice(1)

  const replayNames = dedupeInGameNames([
    playerName,
    ...bots.flatMap(bot => (bot.replayName === undefined ? [] : [bot.replayName])),
  ]).slice(1)
  let replayIndex = 0

  return bots.map((bot, index) => ({
    inGameName: inGameNames[index],
    replayName: bot.replayName === undefined ? undefined : replayNames[replayIndex++],
  }))
}
