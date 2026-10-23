import { TFunction } from 'i18next'
import { describe, expect, test } from 'vitest'
import { GameType } from '../../common/games/game-type'
import { makeSbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { SlotType } from '../../common/lobbies/slot'
import { MatchmakingType } from '../../common/matchmaking'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { ParticipatingGameInfo } from '../games/game-atoms'
import { ActivityLobby, DiscordActivityState, getDiscordActivity } from './discord-activity'

/** Returns each string's default text with its `{{placeholders}}` filled in. */
const t = ((_key: string, defaultValue: string, options?: Record<string, string>) =>
  defaultValue.replace(
    /\{\{(\w+)\}\}/g,
    (_match, name: string) => options?.[name] ?? '',
  )) as unknown as TFunction

const SELF = makeSbUserId(1)
const OPPONENT = makeSbUserId(2)
const LOBBY_ID = makeSbLobbyId('Ek0xQmQzSXu9vMSq1Ya2Ww')

const LISTED_LOBBY: ActivityLobby = {
  id: LOBBY_ID,
  name: 'Fastest 3v3',
  visibility: 'listed',
  playerCount: 4,
  openSlots: 2,
  inGame: false,
}

const ONE_VS_ONE: ParticipatingGameInfo = {
  gameId: 'game-1',
  gameType: GameType.Melee,
  mapName: 'Polypoid',
  slots: [
    { userId: OPPONENT, race: 'z', type: SlotType.Human },
    { userId: SELF, race: 'p', type: SlotType.Human },
  ],
  playingSince: 1_000_000,
}

function stateWith(overrides: Partial<DiscordActivityState>): DiscordActivityState {
  return { sharing: 'on', userId: SELF, lobby: undefined, game: undefined, ...overrides }
}

describe('client/discord/discord-activity', () => {
  test('a listed lobby shows its name and can be joined', () => {
    expect(getDiscordActivity(stateWith({ lobby: LISTED_LOBBY }), t)).toEqual({
      details: 'Fastest 3v3',
      state: 'In a lobby',
      party: {
        id: LOBBY_ID,
        currentSize: 4,
        maxSize: 6,
        joinSecret: `lobby:${LOBBY_ID}`,
      },
    })
  })

  test('an unlisted lobby shows its name but has no party or join secret', () => {
    const activity = getDiscordActivity(
      stateWith({ lobby: { ...LISTED_LOBBY, visibility: 'unlisted' } }),
      t,
    )
    expect(activity?.details).toBe('Fastest 3v3')
    expect(activity?.party).toBeUndefined()
  })

  test("a lobby whose game is loading or running can't be joined", () => {
    const activity = getDiscordActivity(stateWith({ lobby: { ...LISTED_LOBBY, inGame: true } }), t)
    expect(activity?.party).toBeUndefined()
  })

  test("a one-character lobby name is quoted, since Discord won't show it alone", () => {
    const activity = getDiscordActivity(stateWith({ lobby: { ...LISTED_LOBBY, name: 'x' } }), t)
    expect(activity?.details).toBe('“x”')
  })

  test('a 1v1 shows the mode, the matchup from the own side, and when play started', () => {
    expect(getDiscordActivity(stateWith({ game: ONE_VS_ONE }), t)).toEqual({
      details: 'Melee',
      state: 'PvZ',
      startTimestamp: 1_000_000,
    })
  })

  test('a random player shows as R, not the race the game rolled', () => {
    const game: ParticipatingGameInfo = {
      ...ONE_VS_ONE,
      matchmakingType: MatchmakingType.Match1v1,
      slots: [
        { userId: SELF, race: 'r', type: SlotType.Human },
        { userId: OPPONENT, race: 't', type: SlotType.Human },
      ],
    }
    const activity = getDiscordActivity(stateWith({ game }), t)
    expect(activity?.details).toBe('Ranked 1v1')
    expect(activity?.state).toBe('RvT')
  })

  test('a game takes precedence over the lobby it started from', () => {
    const activity = getDiscordActivity(stateWith({ lobby: LISTED_LOBBY, game: ONE_VS_ONE }), t)
    expect(activity?.details).toBe('Melee')
    expect(activity?.party).toBeUndefined()
  })

  test('an observer sees the matchup in slot order', () => {
    const game: ParticipatingGameInfo = {
      ...ONE_VS_ONE,
      slots: [
        ...ONE_VS_ONE.slots.filter(slot => slot.userId !== SELF),
        { userId: SELF, type: SlotType.Observer },
        { userId: makeSbUserId(3), race: 'p', type: SlotType.Human },
      ],
    }
    const activity = getDiscordActivity(stateWith({ game }), t)
    expect(activity?.details).toBe('Observing Melee')
    expect(activity?.state).toBe('ZvP')
  })

  test('a game with more than two players shows no matchup', () => {
    const game: ParticipatingGameInfo = {
      ...ONE_VS_ONE,
      slots: [
        ...ONE_VS_ONE.slots,
        { userId: makeSbUserId(3), race: 't', type: SlotType.Human },
        { race: 'z', type: SlotType.Computer },
      ],
    }
    expect(getDiscordActivity(stateWith({ game }), t)?.state).toBeUndefined()
  })

  test('a Use Map Settings game shows the map name instead of a matchup', () => {
    const game: ParticipatingGameInfo = {
      ...ONE_VS_ONE,
      gameType: GameType.UseMapSettings,
      mapName: 'Big Game Hunters',
    }
    const activity = getDiscordActivity(stateWith({ game }), t)
    expect(activity?.details).toBe('Use map settings')
    expect(activity?.state).toBe('Big Game Hunters')
  })

  test('a map name too long for Discord is shortened', () => {
    const game: ParticipatingGameInfo = {
      ...ONE_VS_ONE,
      gameType: GameType.UseMapSettings,
      mapName: 'x'.repeat(200),
    }
    const state = getDiscordActivity(stateWith({ game }), t)?.state
    expect(Array.from(state!)).toHaveLength(128)
    expect(state!.endsWith('…')).toBe(true)
  })

  test.each(['off', 'notAsked'] as const)('nothing shows while sharing is %s', sharing => {
    expect(
      getDiscordActivity(stateWith({ sharing, lobby: LISTED_LOBBY, game: ONE_VS_ONE }), t),
    ).toBeUndefined()
  })

  test('nothing shows outside a lobby or a game', () => {
    expect(getDiscordActivity(stateWith({}), t)).toBeUndefined()
  })

  test('nothing shows while logged out', () => {
    expect(
      getDiscordActivity(stateWith({ userId: undefined, lobby: LISTED_LOBBY }), t),
    ).toBeUndefined()
  })
})
