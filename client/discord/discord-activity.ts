import { TFunction } from 'i18next'
import {
  DiscordActivity,
  DiscordActivityImage,
  makeLobbyJoinSecret,
} from '../../common/discord-presence'
import { gameTypeToLabel } from '../../common/games/game-type'
import { isUms } from '../../common/lobbies'
import { SlotType } from '../../common/lobbies/slot'
import { matchmakingTypeToLabel } from '../../common/matchmaking'
import { RaceChar, raceCharToLabel } from '../../common/races'
import { DiscordActivitySharing } from '../../common/settings/account-settings'
import {
  CurrentActivity,
  GameActivity,
  LobbyActivity,
  ReplayActivity,
} from '../activity/current-activity'
import { ParticipatingGameInfo } from '../games/game-atoms'

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

/** Returns the icon shown in place of a race while the user observes. */
function getObserverIcon(t: TFunction): DiscordActivityImage {
  return { image: 'observer', text: t('discord.activity.observerIcon', 'Observing') }
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

function getGameActivity({ game, ownSlot }: GameActivity, t: TFunction): DiscordActivity {
  const gameMode =
    game.matchmakingType !== undefined
      ? t('discord.activity.rankedMode', 'Ranked {{mode}}', {
          mode: matchmakingTypeToLabel(game.matchmakingType, t),
        })
      : gameTypeToLabel(game.gameType, t)
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
    smallImage: observing ? getObserverIcon(t) : getRaceIcon(ownRace, t),
  }
}

function getLobbyActivity(lobby: LobbyActivity, t: TFunction): DiscordActivity {
  const listed = lobby.visibility === 'listed'
  // An unlisted lobby's host chose who learns of it, so its name isn't shown. Listed lobby names
  // can be a single character, which Discord won't show on its own.
  const details = listed
    ? (fitDiscordText(lobby.name) ?? fitDiscordText(`“${lobby.name}”`))
    : `🔒 ${t('discord.activity.privateLobby', 'Private lobby')}`
  const joinable = listed && !lobby.inGame

  return {
    details,
    state: lobby.mapName !== undefined ? fitDiscordText(lobby.mapName) : undefined,
    largeImage: getMapImage(lobby.mapImageUrl, lobby.mapName),
    smallImage: lobby.observing ? getObserverIcon(t) : getRaceIcon(lobby.ownRace, t),
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

function getReplayActivity(replay: ReplayActivity, t: TFunction): DiscordActivity {
  return {
    details: t('discord.activity.watchingReplay', 'Watching a replay'),
    state: replay.mapName !== undefined ? fitDiscordText(replay.mapName) : undefined,
  }
}

/**
 * Returns the Rich Presence activity for what the user is doing, or `undefined` if nothing should
 * show: when they haven't chosen to share it, or are doing nothing that shows.
 */
export function getDiscordActivity(
  activity: CurrentActivity | undefined,
  sharing: DiscordActivitySharing,
  t: TFunction,
): DiscordActivity | undefined {
  if (sharing !== 'on' || !activity) {
    return undefined
  }
  switch (activity.kind) {
    case 'game':
      return getGameActivity(activity, t)
    case 'lobby':
      return getLobbyActivity(activity, t)
    case 'replay':
      return getReplayActivity(activity, t)
    default:
      return activity satisfies never
  }
}
