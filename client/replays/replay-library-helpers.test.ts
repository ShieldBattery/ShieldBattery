import { describe, expect, test } from 'vitest'
import { RaceChar } from '../../common/races'
import { ReplayLibraryEntry, ReplayLibraryPlayer } from '../../common/replays-library'
import {
  getReplayDisplayTeams,
  groupReplaysByDay,
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
