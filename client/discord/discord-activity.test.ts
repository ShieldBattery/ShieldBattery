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
const MAP_IMAGE_URL = 'https://cdn.shieldbattery.net/map_images/e4/e3/e4e3-1024.jpg?v=1'

const LISTED_LOBBY: ActivityLobby = {
  id: LOBBY_ID,
  name: 'Fastest 3v3',
  visibility: 'listed',
  playerCount: 4,
  openSlots: 2,
  inGame: false,
  mapName: 'Fastest',
  mapImageUrl: MAP_IMAGE_URL,
  ownRace: 'z',
}

const ONE_VS_ONE: ParticipatingGameInfo = {
  gameId: 'game-1',
  gameType: GameType.Melee,
  mapName: 'Polypoid',
  mapImageUrl: MAP_IMAGE_URL,
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
  describe('lobbies', () => {
    test('a listed lobby shows its name, its map and the own race, and can be joined', () => {
      expect(getDiscordActivity(stateWith({ lobby: LISTED_LOBBY }), t)).toEqual({
        details: 'Fastest 3v3',
        state: 'Fastest',
        largeImage: { image: MAP_IMAGE_URL, text: 'Fastest' },
        smallImage: { image: 'race_z', text: 'Zerg' },
        party: {
          id: LOBBY_ID,
          currentSize: 4,
          maxSize: 6,
          joinSecret: `lobby:${LOBBY_ID}`,
        },
      })
    })

    test('an unlisted lobby has no party or join secret', () => {
      const activity = getDiscordActivity(
        stateWith({ lobby: { ...LISTED_LOBBY, visibility: 'unlisted' } }),
        t,
      )
      expect(activity?.details).toBe('Fastest 3v3')
      expect(activity?.party).toBeUndefined()
    })

    test("a lobby whose game is loading or running can't be joined", () => {
      const activity = getDiscordActivity(
        stateWith({ lobby: { ...LISTED_LOBBY, inGame: true } }),
        t,
      )
      expect(activity?.party).toBeUndefined()
    })

    test("a one-character lobby name is quoted, since Discord won't show it alone", () => {
      const activity = getDiscordActivity(stateWith({ lobby: { ...LISTED_LOBBY, name: 'x' } }), t)
      expect(activity?.details).toBe('“x”')
    })

    test('an observer gets no race icon', () => {
      const activity = getDiscordActivity(
        stateWith({ lobby: { ...LISTED_LOBBY, ownRace: undefined } }),
        t,
      )
      expect(activity?.smallImage).toBeUndefined()
    })

    test("a map image Discord can't fetch (a dev server's local file store) is left out", () => {
      const activity = getDiscordActivity(
        stateWith({
          lobby: { ...LISTED_LOBBY, mapImageUrl: 'http://localhost:5555/files/map.jpg' },
        }),
        t,
      )
      expect(activity?.largeImage).toBeUndefined()
      expect(activity?.state).toBe('Fastest')
    })

    test('a map image URL too long for Discord is left out', () => {
      const activity = getDiscordActivity(
        stateWith({
          lobby: { ...LISTED_LOBBY, mapImageUrl: `https://cdn.example/${'x'.repeat(300)}.jpg` },
        }),
        t,
      )
      expect(activity?.largeImage).toBeUndefined()
    })
  })

  describe('games', () => {
    test('a 1v1 shows the mode and the matchup from the own side, the map, and its image', () => {
      expect(getDiscordActivity(stateWith({ game: ONE_VS_ONE }), t)).toEqual({
        details: 'Melee · PvZ',
        state: 'Polypoid',
        startTimestamp: 1_000_000,
        largeImage: { image: 'matchup_pvz', text: 'Protoss vs Zerg' },
        smallImage: { image: 'race_p', text: 'Protoss' },
      })
    })

    test('a 1v1 with a random pick shows R and the map image', () => {
      const game: ParticipatingGameInfo = {
        ...ONE_VS_ONE,
        matchmakingType: MatchmakingType.Match1v1,
        slots: [
          { userId: SELF, race: 'r', type: SlotType.Human },
          { userId: OPPONENT, race: 't', type: SlotType.Human },
        ],
      }
      const activity = getDiscordActivity(stateWith({ game }), t)
      expect(activity?.details).toBe('Ranked 1v1 · RvT')
      expect(activity?.largeImage).toEqual({ image: MAP_IMAGE_URL, text: 'Polypoid' })
      expect(activity?.smallImage).toEqual({ image: 'race_r', text: 'Random' })
    })

    test('a game takes precedence over the lobby it started from', () => {
      const activity = getDiscordActivity(stateWith({ lobby: LISTED_LOBBY, game: ONE_VS_ONE }), t)
      expect(activity?.details).toBe('Melee · PvZ')
      expect(activity?.party).toBeUndefined()
    })

    test('an observer sees the matchup in slot order, without a race icon', () => {
      const game: ParticipatingGameInfo = {
        ...ONE_VS_ONE,
        slots: [
          { userId: OPPONENT, race: 'z', type: SlotType.Human },
          { userId: SELF, type: SlotType.Observer },
          { userId: makeSbUserId(3), race: 'p', type: SlotType.Human },
        ],
      }
      const activity = getDiscordActivity(stateWith({ game }), t)
      expect(activity?.details).toBe('Observing Melee · ZvP')
      expect(activity?.largeImage?.image).toBe('matchup_zvp')
      expect(activity?.smallImage).toBeUndefined()
    })

    test('a team game shows the mode, the own race, and the map image', () => {
      const game: ParticipatingGameInfo = {
        ...ONE_VS_ONE,
        matchmakingType: MatchmakingType.Match2v2,
        slots: [
          ...ONE_VS_ONE.slots,
          { userId: makeSbUserId(3), race: 't', type: SlotType.Human },
          { userId: makeSbUserId(4), race: 'z', type: SlotType.Human },
        ],
      }
      const activity = getDiscordActivity(stateWith({ game }), t)
      expect(activity?.details).toBe('Ranked 2v2 · Protoss')
      expect(activity?.state).toBe('Polypoid')
      expect(activity?.largeImage).toEqual({ image: MAP_IMAGE_URL, text: 'Polypoid' })
      expect(activity?.smallImage).toEqual({ image: 'race_p', text: 'Protoss' })
    })

    test('a Use Map Settings game shows the own race and the map, even with two players', () => {
      const game: ParticipatingGameInfo = {
        ...ONE_VS_ONE,
        gameType: GameType.UseMapSettings,
        mapName: 'Big Game Hunters',
      }
      const activity = getDiscordActivity(stateWith({ game }), t)
      expect(activity?.details).toBe('Use map settings · Protoss')
      expect(activity?.state).toBe('Big Game Hunters')
      expect(activity?.largeImage).toEqual({ image: MAP_IMAGE_URL, text: 'Big Game Hunters' })
    })

    test('a map name too long for Discord is shortened', () => {
      const game: ParticipatingGameInfo = { ...ONE_VS_ONE, mapName: 'x'.repeat(200) }
      const state = getDiscordActivity(stateWith({ game }), t)?.state
      expect(Array.from(state!)).toHaveLength(128)
      expect(state!.endsWith('…')).toBe(true)
    })
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
