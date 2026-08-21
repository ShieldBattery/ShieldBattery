import { TypedGroupRegExpMatchArray } from '../regex'

export interface CustomEmoteInfo {
  /** The identifier used in message text, e.g. `bwProbe` for `:bwProbe:`. */
  code: string
  /** A short human-readable name, used in pickers and autocomplete. */
  name: string
}

/**
 * The set of custom emotes that chat understands. Messages carry emotes as plain `:code:` text,
 * so clients that know a code render its image while anything else (e.g. older clients) shows the
 * literal text.
 */
export const CUSTOM_EMOTES: ReadonlyArray<CustomEmoteInfo> = [
  // Protoss
  { code: 'bwProbe', name: 'Probe' },
  { code: 'bwZealot', name: 'Zealot' },
  { code: 'bwDragoon', name: 'Dragoon' },
  { code: 'bwHighTemplar', name: 'High Templar' },
  { code: 'bwDarkTemplar', name: 'Dark Templar' },
  { code: 'bwArchon', name: 'Archon' },
  { code: 'bwDarkArchon', name: 'Dark Archon' },
  { code: 'bwReaver', name: 'Reaver' },
  { code: 'bwCarrier', name: 'Carrier' },
  { code: 'bwPylon', name: 'Pylon' },
  // Terran
  { code: 'bwScv', name: 'SCV' },
  { code: 'bwMarine', name: 'Marine' },
  { code: 'bwFirebat', name: 'Firebat' },
  { code: 'bwGhost', name: 'Ghost' },
  { code: 'bwVulture', name: 'Vulture' },
  { code: 'bwTank', name: 'Siege Tank' },
  { code: 'bwGoliath', name: 'Goliath' },
  { code: 'bwWraith', name: 'Wraith' },
  { code: 'bwBattlecruiser', name: 'Battlecruiser' },
  { code: 'bwNuke', name: 'Nuclear launch' },
  // Zerg
  { code: 'bwDrone', name: 'Drone' },
  { code: 'bwZergling', name: 'Zergling' },
  { code: 'bwHydralisk', name: 'Hydralisk' },
  { code: 'bwLurker', name: 'Lurker' },
  { code: 'bwMutalisk', name: 'Mutalisk' },
  { code: 'bwUltralisk', name: 'Ultralisk' },
  { code: 'bwDefiler', name: 'Defiler' },
  { code: 'bwOverlord', name: 'Overlord' },
  // Misc
  { code: 'bwMineral', name: 'Minerals' },
  { code: 'bwGg', name: 'Good game' },
]

/**
 * Regex for detecting custom emotes in message text. Only the known codes match (in the "code"
 * capture group), so arbitrary `:word:` text is left alone. Matching is case-insensitive since
 * various producers (e.g. emoji picker libraries) normalize codes to lowercase.
 */
export const CUSTOM_EMOTE_REGEX = new RegExp(
  `:(?<code>${CUSTOM_EMOTES.map(e => e.code).join('|')}):`,
  'gi',
)

export interface CustomEmoteGroups {
  code: string
}

export interface CustomEmoteMatch {
  type: 'customEmote'
  text: string
  index: number
  groups: CustomEmoteGroups
}

/** Matches all custom emotes (`:code:` for a known code) in a given text. */
export function* matchCustomEmotes(text: string): Generator<CustomEmoteMatch> {
  const matches: IterableIterator<TypedGroupRegExpMatchArray<keyof CustomEmoteGroups>> =
    text.matchAll(CUSTOM_EMOTE_REGEX) as IterableIterator<any>

  for (const match of matches) {
    yield {
      type: 'customEmote',
      text: match[0],
      index: match.index!,
      groups: match.groups,
    }
  }
}
