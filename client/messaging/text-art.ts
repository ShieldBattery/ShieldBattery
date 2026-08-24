/**
 * Discord-style text art commands for the chat input: a message starting with `/shrug`,
 * `/tableflip`, etc. gets the command replaced with its art at send time. The art is plain
 * Unicode text, so nothing downstream needs to understand the commands.
 */

// NOTE: Multi-line art is supported (it goes on its own lines when applied), but it displays in
// a proportional font, so monospace-aligned art won't line up as authored — any multi-line art
// added here needs its spacing tuned for how the app's font actually measures, and should be
// eyeballed in chat to make sure it reads well.
export const TEXT_ART_COMMANDS: ReadonlyArray<{ command: string; art: string }> = [
  { command: 'shrug', art: '¯\\_(ツ)_/¯' },
  { command: 'tableflip', art: '(╯°□°)╯︵ ┻━┻' },
  { command: 'unflip', art: '┬─┬ ノ( ゜-゜ノ)' },
  { command: 'disapprove', art: 'ಠ_ಠ' },
  { command: 'lenny', art: '( ͡° ͜ʖ ͡°)' },
  { command: 'bear', art: 'ʕ•ᴥ•ʔ' },
  { command: 'fight', art: "(ง'̀-'́)ง" },
  { command: 'cry', art: '(ಥ﹏ಥ)' },
  { command: 'cheer', art: 'ヽ(^o^)ノ' },
  { command: 'salute', art: 'o7' },
]

const COMMAND_REGEX = new RegExp(
  `^/(?<command>${TEXT_ART_COMMANDS.map(c => c.command).join('|')})(?=\\s|$)`,
  'i',
)

/**
 * Applies a leading text art command to a message, Discord-style: the rest of the message (if
 * any) comes first with the art appended after it, so `/shrug oh well` becomes
 * `oh well ¯\_(ツ)_/¯`. Messages without a leading known command are returned unchanged.
 * Multi-line art goes on its own lines, since its alignment depends on starting at a line start.
 */
export function applyTextArtCommand(message: string): string {
  const match = COMMAND_REGEX.exec(message)
  if (!match) {
    return message
  }

  const art = TEXT_ART_COMMANDS.find(c => c.command === match.groups!.command.toLowerCase())!.art
  const rest = message.slice(match[0].length).trim()
  if (!rest) {
    return art
  }
  return art.includes('\n') ? `${rest}\n${art}` : `${rest} ${art}`
}
