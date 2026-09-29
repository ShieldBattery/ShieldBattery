import { ResultOf } from '@graphql-typed-document-node/core'
import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { useQuery } from 'urql'
import { SbChannelId } from '../../common/chat'
import { MatchmakingType, matchmakingTypeToLabel } from '../../common/matchmaking'
import { RaceChar } from '../../common/races'
import { SbUserId } from '../../common/users/sb-user-id'
import { useSelfUser } from '../auth/auth-utils'
import { ConnectedAvatar } from '../avatars/avatar'
import { AvatarStack } from '../avatars/avatar-stack'
import { getGameResultsUrl } from '../games/action-creators'
import { graphql } from '../gql'
import { MaterialIcon } from '../icons/material/material-icon'
import { RaceIcon } from '../lobbies/race-icon'
import { UploadedMapImage } from '../maps/map-image'
import { buttonReset } from '../material/button-reset'
import { EllipsizedText } from '../material/ellipsized-text'
import { LinkButton } from '../material/link-button'
import { ChatContext } from '../messaging/chat-context'
import { useMentionFilterClick } from '../messaging/mention-hooks'
import { useAppSelector } from '../redux-hooks'
import { bodySmall, labelMedium, singleLine, titleSmall } from '../styles/typography'
import { useStreamUptime } from '../twitch/live-indicators'
import { LIVE_STREAMS_POLL_INTERVAL_MS, useQueryPolling } from '../twitch/live-state'
import { ConnectedUsername } from '../users/connected-username'
import { UsersState } from './chat-reducer'

/**
 * Both public "happening now" feeds in one operation. Streams reuse the home page's feed fragment
 * so the same entries can render here. The channel's entries are whatever in these feeds involves
 * a channel member, worked out on the client, so a channel costs the same two feed queries the
 * home page already makes and never a per-member lookup.
 */
const ChannelActivityQuery = graphql(/* GraphQL */ `
  query ChannelActivity {
    liveStreams {
      id
      twitchLogin
      viewerCount
      user {
        id
        name
      }
      ...LiveStreams_FeedEntryFragment
    }
    liveGames {
      id
      startTime
      map {
        id
        name
        mapFile {
          id
          image256Url
          image512Url
          image1024Url
          image2048Url
          width
          height
        }
      }
      config {
        __typename
        ... on GameConfigDataMatchmaking {
          gameSourceExtra {
            matchmakingType
          }
          teams {
            race
            user {
              id
              name
            }
          }
        }
      }
    }
  }
`)

type ChannelActivityData = ResultOf<typeof ChannelActivityQuery>
export type LiveStreamItem = ChannelActivityData['liveStreams'][number]

export interface GameActivityPlayer {
  userId: SbUserId
  name: string
  race: RaceChar
}

export interface GameActivityEntry {
  gameId: string
  /** The channel members playing in this game, in team order. Never empty. */
  members: ReadonlyArray<SbUserId>
  /**
   * Everyone in the game, by team. Matchmaking puts both players of a 1v1 in the first team, so a
   * 1v1 is a single team of two.
   */
  teams: ReadonlyArray<ReadonlyArray<GameActivityPlayer>>
  matchmakingType: MatchmakingType
  /** When the game started, in unix ms. */
  startTime: number
  map: ChannelActivityData['liveGames'][number]['map']
}

/** The channel's members: anyone in its active or offline set counts. */
type ChannelMembers = ReadonlyDeep<Pick<UsersState, 'active' | 'offline'>>

function isMember(users: ChannelMembers, userId: SbUserId): boolean {
  return users.active.has(userId) || users.offline.has(userId)
}

export interface ChannelActivity {
  streams: ReadonlyArray<LiveStreamItem>
  games: ReadonlyArray<GameActivityEntry>
}

const NO_ACTIVITY: ChannelActivity = { streams: [], games: [] }

/**
 * Narrows the public feeds to what involves this channel: members' streams (most watched first),
 * then live games with at least one member in them (newest first). The viewer's own stream and
 * game are left out; they know what they're doing.
 */
export function deriveActivityEntries(
  data: ChannelActivityData,
  users: ChannelMembers,
  selfUserId: SbUserId | undefined,
): ChannelActivity {
  const streams: LiveStreamItem[] = []
  for (const stream of data.liveStreams) {
    if (!stream.user || stream.user.id === selfUserId || !isMember(users, stream.user.id)) {
      continue
    }
    streams.push(stream)
  }
  streams.sort((a, b) => b.viewerCount - a.viewerCount)

  const games: GameActivityEntry[] = []
  for (const game of data.liveGames) {
    if (game.config.__typename !== 'GameConfigDataMatchmaking') {
      continue
    }
    const teams = game.config.teams.map(team =>
      team.flatMap(p => (p.user ? [{ userId: p.user.id, name: p.user.name, race: p.race }] : [])),
    )
    const players = teams.flat()
    if (players.some(p => p.userId === selfUserId)) {
      continue
    }
    const members = players.filter(p => isMember(users, p.userId)).map(p => p.userId)
    if (!members.length) {
      continue
    }
    games.push({
      gameId: game.id,
      members,
      teams,
      matchmakingType: game.config.gameSourceExtra.matchmakingType,
      startTime: new Date(game.startTime).getTime(),
      map: game.map,
    })
  }
  games.sort((a, b) => b.startTime - a.startTime)

  return { streams, games }
}

/**
 * What a channel's members are streaming and playing right now, from the public live feeds
 * intersected with the channel's member sets. Polls on the same cadence as the home page's live
 * sections while mounted.
 */
export function useChannelActivity(channelId: SbChannelId): ChannelActivity {
  const selfUserId = useSelfUser()?.id
  const channelUsers = useAppSelector(s => s.chat.idToUsers.get(channelId))
  const [{ data }, reexecuteQuery] = useQuery({
    query: ChannelActivityQuery,
    // Never suspend: this sits inside the channel page with no boundary of its own, and missing
    // activity is far better than a blanked chat while the feeds load.
    context: { ttl: 10 * 1000, suspense: false },
  })
  useQueryPolling(reexecuteQuery, LIVE_STREAMS_POLL_INTERVAL_MS)

  return data && channelUsers ? deriveActivityEntries(data, channelUsers, selfUserId) : NO_ACTIVITY
}

const GameRoot = styled.div`
  margin: 0 8px;
  /* The stack's overlap ring has to be opaque and match whatever it sits on. */
  --sb-avatar-stack-ring: var(--theme-container-low);
`

const GameHeader = styled.button`
  ${buttonReset};
  width: 100%;
  height: 56px;
  padding: 0 4px 0 8px;

  display: flex;
  align-items: center;
  gap: 10px;

  border-radius: 4px;
  text-align: left;

  &:hover,
  &:focus-visible {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
    outline: none;
  }
`

const GameMap = styled(UploadedMapImage)`
  width: 40px;
  height: 40px;
  flex-shrink: 0;

  border-radius: 4px;
  overflow: hidden;
  background-color: var(--theme-container-highest);

  & > img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`

const GameMapFallback = styled.div`
  width: 40px;
  height: 40px;
  flex-shrink: 0;

  border-radius: 4px;
  background-color: var(--theme-container-highest);
`

const GameText = styled.div`
  flex: 1;
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 2px;
`

const GameLine = styled.div`
  height: 20px;

  display: flex;
  align-items: center;
  gap: 8px;
`

const GameMode = styled(EllipsizedText)`
  ${titleSmall};
  flex: 1;
`

const GameElapsed = styled.span`
  ${bodySmall};
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

const GameMapName = styled(EllipsizedText)`
  ${bodySmall};
  flex: 1;
  color: var(--theme-on-surface-variant);
`

const Chevron = styled(MaterialIcon).attrs({ size: 20 })`
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
`

// Lines the players and the link up under the row's text, past the map thumbnail.
const GameDetails = styled.div`
  padding: 0 8px 8px 58px;

  display: flex;
  flex-direction: column;
`

const TeamDivider = styled.div`
  height: 1px;
  margin: 4px 0;
  background-color: var(--theme-outline-variant);
`

const GameLink = styled(LinkButton)`
  ${labelMedium};
  align-self: flex-start;
  height: 28px;
  margin-top: 4px;

  display: flex;
  align-items: center;

  text-decoration: none;

  &:link,
  &:visited {
    color: var(--theme-amber);
  }

  &:hover,
  &:focus-visible {
    text-decoration: underline;
    outline: none;
  }
`

/**
 * A live game with at least one channel member in it. Collapsed, it's the map, mode, elapsed time,
 * map name and the members as an avatar stack; expanded, it adds everyone playing, by team, with
 * their races, and a link to the game. Whether it's expanded is up to the caller, since the list
 * this sits in unmounts rows that scroll out of view.
 */
export function ActivityGameEntry({
  entry,
  expanded,
  onToggle,
}: {
  entry: GameActivityEntry
  expanded: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const elapsed = useStreamUptime(entry.startTime)
  const mode = matchmakingTypeToLabel(entry.matchmakingType, t)

  return (
    <GameRoot>
      <GameHeader
        type='button'
        aria-expanded={expanded}
        aria-label={t('chat.activity.gameLabel', '{{mode}} on {{map}}, {{elapsed}}', {
          mode,
          map: entry.map.name,
          elapsed,
        })}
        onClick={onToggle}>
        <GameMap map={entry.map} size={40} forceAspectRatio={1} noImageElem={<GameMapFallback />} />
        <GameText>
          <GameLine>
            <GameMode text={mode} />
            <GameElapsed>{elapsed}</GameElapsed>
          </GameLine>
          <GameLine>
            <GameMapName text={entry.map.name} />
            <AvatarStack userIds={entry.members} size={20} max={3} />
          </GameLine>
        </GameText>
        <Chevron icon={expanded ? 'expand_less' : 'chevron_right'} />
      </GameHeader>
      {expanded ? (
        <GameDetails>
          {entry.teams.map((team, i) => (
            <div key={i}>
              {i > 0 ? <TeamDivider /> : null}
              {team.map(player => (
                <GamePlayerEntry key={player.userId} player={player} />
              ))}
            </div>
          ))}
          <GameLink href={getGameResultsUrl(entry.gameId)}>
            {t('chat.activity.viewGame', 'View game')}
          </GameLink>
        </GameDetails>
      ) : null}
    </GameRoot>
  )
}

const PlayerRoot = styled.div`
  height: 28px;

  display: flex;
  align-items: center;
  gap: 8px;
`

const PlayerAvatar = styled(ConnectedAvatar)`
  width: 20px;
  height: 20px;
  flex-shrink: 0;
`

const PlayerName = styled(ConnectedUsername)`
  ${bodySmall};
  ${singleLine};
  display: block;
  min-width: 0;
`

const PlayerRace = styled(RaceIcon)`
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  margin-left: auto;
`

/** One player in an expanded game: their name opens their profile and context menu. */
function GamePlayerEntry({ player }: { player: GameActivityPlayer }) {
  const filterClick = useMentionFilterClick()
  const { UserMenu } = useContext(ChatContext)

  return (
    <PlayerRoot>
      <PlayerAvatar userId={player.userId} showLiveIndicator={false} />
      <PlayerName
        userId={player.userId}
        filterClick={filterClick}
        UserMenu={UserMenu}
        showTooltipForOverflow='top'
        profileSide='left'
      />
      <PlayerRace race={player.race} />
    </PlayerRoot>
  )
}
