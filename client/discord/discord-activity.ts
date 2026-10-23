import { TFunction } from 'i18next'
import {
  DiscordActivity,
  DiscordActivityImage,
  makeLobbyJoinSecret,
} from '../../common/discord-presence'
import { gameTypeToLabel } from '../../common/games/game-type'
import { isUms } from '../../common/lobbies'
import { LobbyVisibility } from '../../common/lobbies/lobby-visibility'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { SlotType } from '../../common/lobbies/slot'
import { matchmakingTypeToLabel } from '../../common/matchmaking'
import { RaceChar, raceCharToLabel } from '../../common/races'
import { DiscordActivitySharing } from '../../common/settings/account-settings'
import { SbUserId } from '../../common/users/sb-user-id'
import { ParticipatingGameInfo } from '../games/game-atoms'

/** What the activity shows about the lobby the user is in. */
export interface ActivityLobby {
  id: SbLobbyId
  name: string
  visibility: LobbyVisibility
  /** The players seated in the lobby, computers included. Observers don't count. */
  playerCount: number
  /** The slots someone could still join as a player. Closed slots don't count. */
  openSlots: number
  /** Whether the lobby's game is loading or running, which makes the lobby unjoinable. */
  inGame: boolean
  mapName?: string
  mapImageUrl?: string
  /** The race picked in the user's slot, or `undefined` while they observe. */
  ownRace?: RaceChar
}

export interface DiscordActivityState {
  sharing: DiscordActivitySharing
  /** The logged-in user, or `undefined` while nobody is logged in. */
  userId: SbUserId | undefined
  /** The lobby the user is in, if any. */
  lobby: ActivityLobby | undefined
  /** The game the user takes part in, only while it's being played. */
  game: ParticipatingGameInfo | undefined
}

const MIN_DISCORD_TEXT_LENGTH = 2
const MAX_DISCORD_TEXT_LENGTH = 128
const MAX_DISCORD_IMAGE_URL_LENGTH = 300

/**
 * Fits text to the 2 to 128 characters Discord accepts for an activity's lines (it rejects the
 * whole activity otherwise), shortening long text and returning `undefined` for text too short.
 */
function fitDiscordText(text: string): string | undefined {
  const chars = Array.from(text.trim())
  if (chars.length < MIN_DISCORD_TEXT_LENGTH) {
    return undefined
  }
  return chars.length > MAX_DISCORD_TEXT_LENGTH
    ? chars.slice(0, MAX_DISCORD_TEXT_LENGTH - 1).join('') + '…'
    : chars.join('')
}

/**
 * Returns a map's image for the activity, or `undefined` if Discord couldn't show it: it fetches
 * images itself, so only public https URLs work, which leaves out the local file store dev servers
 * use.
 */
function getMapImage(
  imageUrl: string | undefined,
  mapName: string | undefined,
): DiscordActivityImage | undefined {
  if (!imageUrl?.startsWith('https://') || imageUrl.length > MAX_DISCORD_IMAGE_URL_LENGTH) {
    return undefined
  }
  return { image: imageUrl, text: mapName !== undefined ? fitDiscordText(mapName) : undefined }
}

/** Returns the icon of the race the user picked. Keys are listed in docs/DISCORD_SDK.md. */
function getRaceIcon(race: RaceChar | undefined, t: TFunction): DiscordActivityImage | undefined {
  return race ? { image: `race_${race}`, text: raceCharToLabel(race, t) } : undefined
}

const PLAYER_SLOT_TYPES: ReadonlySet<SlotType> = new Set([
  SlotType.Human,
  SlotType.Computer,
  SlotType.UmsComputer,
])

/**
 * Returns the matchup of a game with two players (e.g. "PvZ"), from `ownSlot`'s side if it's one of
 * them, or `undefined` for any other number of players. Uses the races as picked, so a random
 * player is R.
 */
function getMatchup(
  slots: ParticipatingGameInfo['slots'],
  ownSlot: ParticipatingGameInfo['slots'][number] | undefined,
): string | undefined {
  const players = slots.filter(slot => PLAYER_SLOT_TYPES.has(slot.type))
  if (players.length !== 2) {
    return undefined
  }
  if (ownSlot && players[1] === ownSlot) {
    players.reverse()
  }
  return players.map(slot => (slot.race ?? 'r').toUpperCase()).join('v')
}

function getGameActivity(
  game: ParticipatingGameInfo,
  userId: SbUserId,
  t: TFunction,
): DiscordActivity {
  const gameMode =
    game.matchmakingType !== undefined
      ? t('discord.activity.rankedMode', 'Ranked {{mode}}', {
          mode: matchmakingTypeToLabel(game.matchmakingType, t),
        })
      : gameTypeToLabel(game.gameType, t)
  const ownSlot = game.slots.find(slot => slot.userId === userId)
  const observing = ownSlot?.type === SlotType.Observer
  const ownRace = observing ? undefined : ownSlot?.race
  const mode = observing
    ? t('discord.activity.observing', 'Observing {{mode}}', { mode: gameMode })
    : gameMode
  const matchup = isUms(game.gameType)
    ? undefined
    : getMatchup(game.slots, observing ? undefined : ownSlot)

  let details = mode
  if (matchup) {
    details = t('discord.activity.modeWithMatchup', '{{mode}} · {{matchup}}', { mode, matchup })
  } else if (ownRace) {
    details = t('discord.activity.modeWithRace', '{{mode}} · {{race}}', {
      mode,
      race: raceCharToLabel(ownRace, t),
    })
  }

  return {
    details: fitDiscordText(details),
    state: fitDiscordText(game.mapName),
    startTimestamp: game.playingSince,
    largeImage: getMapImage(game.mapImageUrl, game.mapName),
    smallImage: getRaceIcon(ownRace, t),
  }
}

function getLobbyActivity(lobby: ActivityLobby, t: TFunction): DiscordActivity {
  // Lobby names can be a single character, which Discord won't show on its own.
  const details = fitDiscordText(lobby.name) ?? fitDiscordText(`“${lobby.name}”`)
  const joinable = lobby.visibility === 'listed' && !lobby.inGame

  return {
    details,
    state: lobby.mapName !== undefined ? fitDiscordText(lobby.mapName) : undefined,
    largeImage: getMapImage(lobby.mapImageUrl, lobby.mapName),
    smallImage: getRaceIcon(lobby.ownRace, t),
    // Discord shows the size after the state, e.g. "Fighting Spirit (2 of 4)", and offers to join
    // while there's room.
    party: joinable
      ? {
          id: lobby.id,
          currentSize: lobby.playerCount,
          maxSize: lobby.playerCount + lobby.openSlots,
          joinSecret: makeLobbyJoinSecret(lobby.id),
        }
      : undefined,
  }
}

/**
 * Returns the Rich Presence activity for the user's current state, or `undefined` if nothing should
 * show: when they haven't chosen to share it, or aren't in a lobby or a game.
 */
export function getDiscordActivity(
  state: DiscordActivityState,
  t: TFunction,
): DiscordActivity | undefined {
  if (state.sharing !== 'on' || state.userId === undefined) {
    return undefined
  }
  if (state.game) {
    return getGameActivity(state.game, state.userId, t)
  }
  if (state.lobby) {
    return getLobbyActivity(state.lobby, t)
  }
  return undefined
}
