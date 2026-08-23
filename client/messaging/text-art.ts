/**
 * Discord-style text art commands for the chat input: a message starting with `/shrug`,
 * `/tableflip`, etc. gets the command replaced with its art at send time. The art is plain
 * Unicode text, so nothing downstream needs to understand the commands.
 */

// NOTE: Multi-line art is displayed in a proportional font, so monospace-aligned art won't line
// up as authored. This art's spacing is tuned for how the app's font actually measures (spaces
// are much narrower than the other glyphs, hence the long leading runs). Anything added or
// changed here should be eyeballed in chat to make sure it still reads well.
const TREX = [
  '                    __',
  '                  /  _)',
  '      _.----._/ /',
  '    /             /',
  '__/ (   |  (   |',
  "/__.-'|_|--|_|",
].join('\n')

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
  { command: 'trex', art: TREX },
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
