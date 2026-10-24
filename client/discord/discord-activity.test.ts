import { TFunction } from 'i18next'
import { describe, expect, test } from 'vitest'
import { GameType } from '../../common/games/game-type'
import { makeSbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { SlotType } from '../../common/lobbies/slot'
import { MatchmakingType } from '../../common/matchmaking'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { CurrentActivity, GameActivity, LobbyActivity } from '../activity/current-activity'
import { ParticipatingGameInfo } from '../games/game-atoms'
import { getDiscordActivity } from './discord-activity'

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

const LISTED_LOBBY: LobbyActivity = {
  kind: 'lobby',
  id: LOBBY_ID,
  name: 'Fastest 3v3',
  visibility: 'listed',
  playerCount: 4,
  openSlots: 2,
  inGame: false,
  mapName: 'Fastest',
  mapImageUrl: MAP_IMAGE_URL,
  ownRace: 'z',
  observing: false,
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

/** Returns the activity of the user taking part in `game`. */
function inGame(game: ParticipatingGameInfo): GameActivity {
  return { kind: 'game', game, ownSlot: game.slots.find(slot => slot.userId === SELF) }
}

/** Returns the Discord activity for `activity`, with sharing on. */
function shared(activity: CurrentActivity | undefined) {
  return getDiscordActivity(activity, 'on', t)
}

describe('client/discord/discord-activity', () => {
  describe('lobbies', () => {
    test('a listed lobby shows its name, its map and the own race, and can be joined', () => {
      expect(shared(LISTED_LOBBY)).toEqual({
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

    test('an unlisted lobby shows as private, without its name, a party or a join secret', () => {
      const activity = shared({ ...LISTED_LOBBY, visibility: 'unlisted' })
      expect(activity?.details).toBe('🔒 Private lobby')
      expect(activity?.state).toBe('Fastest')
      expect(activity?.smallImage?.image).toBe('race_z')
      expect(activity?.party).toBeUndefined()
    })

    test("a lobby whose game is loading or running can't be joined", () => {
      expect(shared({ ...LISTED_LOBBY, inGame: true })?.party).toBeUndefined()
    })

    test("a one-character lobby name is quoted, since Discord won't show it alone", () => {
      expect(shared({ ...LISTED_LOBBY, name: 'x' })?.details).toBe('“x”')
    })

    test('an observer gets the observer icon in place of a race icon', () => {
      const activity = shared({ ...LISTED_LOBBY, ownRace: undefined, observing: true })
      expect(activity?.smallImage).toEqual({ image: 'observer', text: 'Observing' })
    })

    test("a map image Discord can't fetch (a dev server's local file store) is left out", () => {
      const activity = shared({
        ...LISTED_LOBBY,
        mapImageUrl: 'http://localhost:5555/files/map.jpg',
      })
      expect(activity?.largeImage).toBeUndefined()
      expect(activity?.state).toBe('Fastest')
    })

    test('a map image URL too long for Discord is left out', () => {
      const activity = shared({
        ...LISTED_LOBBY,
        mapImageUrl: `https://cdn.example/${'x'.repeat(300)}.jpg`,
      })
      expect(activity?.largeImage).toBeUndefined()
    })
  })

  describe('games', () => {
    test('a 1v1 shows the mode and the matchup from the own side, the map, and its image', () => {
      expect(shared(inGame(ONE_VS_ONE))).toEqual({
        details: 'Melee · PvZ',
        state: 'Polypoid',
        startTimestamp: 1_000_000,
        largeImage: { image: MAP_IMAGE_URL, text: 'Polypoid' },
        smallImage: { image: 'race_p', text: 'Protoss' },
      })
    })

    test('a 1v1 with a random pick shows R', () => {
      const activity = shared(
        inGame({
          ...ONE_VS_ONE,
          matchmakingType: MatchmakingType.Match1v1,
          slots: [
            { userId: SELF, race: 'r', type: SlotType.Human },
            { userId: OPPONENT, race: 't', type: SlotType.Human },
          ],
        }),
      )
      expect(activity?.details).toBe('Ranked 1v1 · RvT')
      expect(activity?.largeImage).toEqual({ image: MAP_IMAGE_URL, text: 'Polypoid' })
      expect(activity?.smallImage).toEqual({ image: 'race_r', text: 'Random' })
    })

    test('an observer sees the matchup in slot order, with the observer icon', () => {
      const activity = shared(
        inGame({
          ...ONE_VS_ONE,
          slots: [
            { userId: OPPONENT, race: 'z', type: SlotType.Human },
            { userId: SELF, type: SlotType.Observer },
            { userId: makeSbUserId(3), race: 'p', type: SlotType.Human },
          ],
        }),
      )
      expect(activity?.details).toBe('Observing Melee · ZvP')
      expect(activity?.smallImage).toEqual({ image: 'observer', text: 'Observing' })
    })

    test('a team game shows the mode, the own race, and the map image', () => {
      const activity = shared(
        inGame({
          ...ONE_VS_ONE,
          matchmakingType: MatchmakingType.Match2v2,
          slots: [
            ...ONE_VS_ONE.slots,
            { userId: makeSbUserId(3), race: 't', type: SlotType.Human },
            { userId: makeSbUserId(4), race: 'z', type: SlotType.Human },
          ],
        }),
      )
      expect(activity?.details).toBe('Ranked 2v2 · Protoss')
      expect(activity?.state).toBe('Polypoid')
      expect(activity?.largeImage).toEqual({ image: MAP_IMAGE_URL, text: 'Polypoid' })
      expect(activity?.smallImage).toEqual({ image: 'race_p', text: 'Protoss' })
    })

    test('a Use Map Settings game shows the own race and the map, even with two players', () => {
      const activity = shared(
        inGame({ ...ONE_VS_ONE, gameType: GameType.UseMapSettings, mapName: 'Big Game Hunters' }),
      )
      expect(activity?.details).toBe('Use map settings · Protoss')
      expect(activity?.state).toBe('Big Game Hunters')
      expect(activity?.largeImage).toEqual({ image: MAP_IMAGE_URL, text: 'Big Game Hunters' })
    })

    test('a map name too long for Discord is shortened', () => {
      const state = shared(inGame({ ...ONE_VS_ONE, mapName: 'x'.repeat(200) }))?.state
      expect(Array.from(state!)).toHaveLength(128)
      expect(state!.endsWith('…')).toBe(true)
    })
  })

  describe('replays', () => {
    test('a replay shows that the user is watching one, its map and the replay icon', () => {
      expect(shared({ kind: 'replay', mapName: 'Polypoid' })).toEqual({
        details: 'Watching a replay',
        state: 'Polypoid',
        smallImage: { image: 'replay', text: 'Replay' },
      })
    })

    test("a replay whose map isn't known shows only that the user is watching one", () => {
      expect(shared({ kind: 'replay' })).toEqual({
        details: 'Watching a replay',
        state: undefined,
        smallImage: { image: 'replay', text: 'Replay' },
      })
    })
  })

  test.each(['off', 'notAsked'] as const)('nothing shows while sharing is %s', sharing => {
    expect(getDiscordActivity(LISTED_LOBBY, sharing, t)).toBeUndefined()
    expect(getDiscordActivity(inGame(ONE_VS_ONE), sharing, t)).toBeUndefined()
  })

  test('nothing shows while the user is doing nothing that shows', () => {
    expect(shared(undefined)).toBeUndefined()
  })
})
