import { describe, expect, test } from 'vitest'
import { RaceChar } from '../../common/races'
import { ReplayLibraryEntry, ReplayLibraryPlayer } from '../../common/replays-library'
import { makeSbUserId } from '../../common/users/sb-user-id'
import {
  encodeView,
  getReplayDisplayTeams,
  groupReplaysByDay,
  isManualPlaylistOrder,
  parseView,
  playersToDisplayTeams,
  shouldShowTeamLabels,
} from './replay-library-helpers'

function makePlayer(
  overrides: Partial<ReplayLibraryPlayer> & { slot: number; team: number; race: RaceChar },
): ReplayLibraryPlayer {
  return {
    name: `player-${overrides.slot}`,
    isComputer: false,
    ...overrides,
  }
}

function makeEntry(id: number, gameTime: number): ReplayLibraryEntry {
  return {
    id,
    path: `C:\\replays\\${id}.rep`,
    fileName: `${id}.rep`,
    fileSize: 1000,
    gameTime,
    mapName: 'Fighting Spirit',
    gameType: 2,
    durationFrames: 24 * 600,
    parseError: false,
    players: [],
  }
}

/** Mirrors `makeParseErrorRecord`: zeroed `gameTime`/`durationFrames`, `parseError: true`. */
function makeParseErrorEntry(id: number): ReplayLibraryEntry {
  return {
    id,
    path: `C:\\replays\\${id}.rep`,
    fileName: `${id}.rep`,
    fileSize: 1000,
    gameTime: 0,
    mapName: '',
    gameType: 2,
    durationFrames: 0,
    parseError: true,
    players: [],
  }
}

describe('getReplayDisplayTeams', () => {
  test('splits a single team of two into a 1v1', () => {
    const players = [
      makePlayer({ slot: 0, team: 1, race: 't' }),
      makePlayer({ slot: 1, team: 1, race: 'z' }),
    ]
    const layout = getReplayDisplayTeams(players)
    expect(layout.kind).toBe('oneVsOne')
    expect(layout.teams).toHaveLength(2)
    expect(layout.teams[0]).toHaveLength(1)
    expect(layout.teams[1]).toHaveLength(1)
    expect(shouldShowTeamLabels(layout)).toBe(false)
  })

  test('keeps two explicit teams as-is', () => {
    const players = [
      makePlayer({ slot: 0, team: 1, race: 't' }),
      makePlayer({ slot: 1, team: 1, race: 't' }),
      makePlayer({ slot: 2, team: 2, race: 'z' }),
      makePlayer({ slot: 3, team: 2, race: 'z' }),
    ]
    const layout = getReplayDisplayTeams(players)
    expect(layout.kind).toBe('teams')
    expect(layout.teams.map(t => t.length)).toEqual([2, 2])
    expect(shouldShowTeamLabels(layout)).toBe(true)
  })

  test('orders teams by team number', () => {
    const players = [
      makePlayer({ slot: 0, team: 3, race: 'z' }),
      makePlayer({ slot: 1, team: 1, race: 't' }),
    ]
    const layout = getReplayDisplayTeams(players)
    // Two singleton teams => kept as teams, ordered by team number.
    expect(layout.kind).toBe('teams')
    expect(layout.teams[0][0].team).toBe(1)
    expect(layout.teams[1][0].team).toBe(3)
  })

  test('treats many singleton teams as an unlabeled FFA', () => {
    const players = [
      makePlayer({ slot: 0, team: 1, race: 't' }),
      makePlayer({ slot: 1, team: 2, race: 'z' }),
      makePlayer({ slot: 2, team: 3, race: 'p' }),
      makePlayer({ slot: 3, team: 4, race: 't' }),
    ]
    const layout = getReplayDisplayTeams(players)
    expect(layout.kind).toBe('teams')
    expect(layout.teams).toHaveLength(4)
    expect(shouldShowTeamLabels(layout)).toBe(false)
  })

  test('balances an unsplittable single team across two columns', () => {
    const players = [
      makePlayer({ slot: 0, team: 1, race: 't' }),
      makePlayer({ slot: 1, team: 1, race: 'z' }),
      makePlayer({ slot: 2, team: 1, race: 'p' }),
    ]
    const layout = getReplayDisplayTeams(players)
    expect(layout.kind).toBe('flat')
    expect(layout.teams.map(t => t.length)).toEqual([2, 1])
    expect(shouldShowTeamLabels(layout)).toBe(false)
  })

  test('renders a lone player as a single column', () => {
    const players = [makePlayer({ slot: 0, team: 1, race: 'p' })]
    const layout = getReplayDisplayTeams(players)
    expect(layout.kind).toBe('flat')
    expect(layout.teams).toHaveLength(1)
    expect(layout.teams[0]).toHaveLength(1)
  })
})

describe('playersToDisplayTeams', () => {
  const computerLabel = 'Computer'

  test('uses the in-replay name when no resolved names map is given', () => {
    const layout = getReplayDisplayTeams([
      makePlayer({ slot: 0, team: 1, race: 't', name: 'raw-name', sbUserId: makeSbUserId(1) }),
    ])
    const teams = playersToDisplayTeams(layout, computerLabel)
    expect(teams[0][0].name).toBe('raw-name')
  })

  test("uses the resolved name when the player's sbUserId is present in the map", () => {
    const layout = getReplayDisplayTeams([
      makePlayer({ slot: 0, team: 1, race: 't', name: 'stale-name', sbUserId: makeSbUserId(1) }),
    ])
    const resolvedNames = new Map([[makeSbUserId(1), 'current-name']])
    const teams = playersToDisplayTeams(layout, computerLabel, resolvedNames)
    expect(teams[0][0].name).toBe('current-name')
  })

  test('falls back to the in-replay name when the sbUserId has no entry in the map', () => {
    const layout = getReplayDisplayTeams([
      makePlayer({ slot: 0, team: 1, race: 't', name: 'raw-name', sbUserId: makeSbUserId(1) }),
    ])
    const resolvedNames = new Map([[makeSbUserId(2), 'someone-else']])
    const teams = playersToDisplayTeams(layout, computerLabel, resolvedNames)
    expect(teams[0][0].name).toBe('raw-name')
  })

  test('falls back to the in-replay name for players without an sbUserId', () => {
    const layout = getReplayDisplayTeams([
      makePlayer({ slot: 0, team: 1, race: 't', name: 'bnet-name' }),
    ])
    const resolvedNames = new Map([[makeSbUserId(1), 'current-name']])
    const teams = playersToDisplayTeams(layout, computerLabel, resolvedNames)
    expect(teams[0][0].name).toBe('bnet-name')
  })

  test('always shows the computer label for computer players, ignoring resolved names', () => {
    const layout = getReplayDisplayTeams([
      makePlayer({
        slot: 0,
        team: 1,
        race: 't',
        name: 'Computer',
        isComputer: true,
        sbUserId: makeSbUserId(1),
      }),
    ])
    const resolvedNames = new Map([[makeSbUserId(1), 'current-name']])
    const teams = playersToDisplayTeams(layout, computerLabel, resolvedNames)
    expect(teams[0][0].name).toBe(computerLabel)
  })
})

describe('groupReplaysByDay', () => {
  test('buckets consecutive entries by local calendar day, newest-first', () => {
    // Use local-time constructors so the expectation matches the machine's timezone.
    const day1Evening = new Date(2024, 4, 10, 21, 30).getTime()
    const day1Morning = new Date(2024, 4, 10, 8, 15).getTime()
    const day2 = new Date(2024, 4, 9, 12, 0).getTime()

    const entries = [makeEntry(3, day1Evening), makeEntry(2, day1Morning), makeEntry(1, day2)]
    const groups = groupReplaysByDay(entries)

    expect(groups).toHaveLength(2)
    expect(groups[0].entries.map(e => e.id)).toEqual([3, 2])
    expect(groups[1].entries.map(e => e.id)).toEqual([1])
    expect(groups[0].dayStartMs).toBe(new Date(2024, 4, 10, 0, 0, 0, 0).getTime())
    expect(groups[1].dayStartMs).toBe(new Date(2024, 4, 9, 0, 0, 0, 0).getTime())
  })

  test('returns no groups for an empty list', () => {
    expect(groupReplaysByDay([])).toEqual([])
  })

  test('trailing parse-error entries land in a single unreadable group after the day groups', () => {
    const day1 = new Date(2024, 4, 10, 21, 30).getTime()
    const day2 = new Date(2024, 4, 9, 12, 0).getTime()

    const entries = [
      makeEntry(3, day1),
      makeEntry(2, day2),
      makeParseErrorEntry(102),
      makeParseErrorEntry(101),
    ]
    const groups = groupReplaysByDay(entries)

    expect(groups).toHaveLength(3)
    expect(groups[0].entries.map(e => e.id)).toEqual([3])
    expect(groups[1].entries.map(e => e.id)).toEqual([2])
    expect(groups[2].unreadable).toBe(true)
    expect(groups[2].entries.map(e => e.id)).toEqual([102, 101])
  })

  test('a list of only parse-error entries yields just the unreadable group', () => {
    const entries = [makeParseErrorEntry(2), makeParseErrorEntry(1)]
    const groups = groupReplaysByDay(entries)

    expect(groups).toHaveLength(1)
    expect(groups[0].unreadable).toBe(true)
    expect(groups[0].entries.map(e => e.id)).toEqual([2, 1])
  })
})

describe('parseView / encodeView', () => {
  test('parses an empty value as the "all" view', () => {
    expect(parseView('')).toEqual({ kind: 'all' })
  })

  test('parses "starred" as the starred view', () => {
    expect(parseView('starred')).toEqual({ kind: 'starred' })
  })

  test('parses "pl-<id>" as a playlist view', () => {
    expect(parseView('pl-42')).toEqual({ kind: 'playlist', id: 42 })
  })

  test('falls back to "all" for malformed playlist ids', () => {
    expect(parseView('pl-notanumber')).toEqual({ kind: 'all' })
    expect(parseView('pl-')).toEqual({ kind: 'all' })
  })

  test('falls back to "all" for unrecognized values', () => {
    expect(parseView('something-else')).toEqual({ kind: 'all' })
  })

  test('round-trips through encodeView', () => {
    expect(encodeView({ kind: 'all' })).toBe('')
    expect(encodeView({ kind: 'starred' })).toBe('starred')
    expect(encodeView({ kind: 'playlist', id: 42 })).toBe('pl-42')
    expect(parseView(encodeView({ kind: 'playlist', id: 7 }))).toEqual({
      kind: 'playlist',
      id: 7,
    })
  })
})

describe('isManualPlaylistOrder', () => {
  test('is true only for a playlist view with no explicit sort', () => {
    expect(isManualPlaylistOrder({ kind: 'playlist', id: 1 }, '')).toBe(true)
  })

  test('is false when a sort is explicitly chosen', () => {
    expect(isManualPlaylistOrder({ kind: 'playlist', id: 1 }, 'latest')).toBe(false)
  })

  test('is false for non-playlist views', () => {
    expect(isManualPlaylistOrder({ kind: 'all' }, '')).toBe(false)
    expect(isManualPlaylistOrder({ kind: 'starred' }, '')).toBe(false)
  })
})
