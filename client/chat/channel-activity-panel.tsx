import { ResultOf } from '@graphql-typed-document-node/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { useQuery } from 'urql'
import { SbChannelId } from '../../common/chat'
import { MatchmakingType, matchmakingTypeToLabel } from '../../common/matchmaking'
import { FriendActivityStatus } from '../../common/users/relationships'
import { SbUserId } from '../../common/users/sb-user-id'
import { useSelfUser } from '../auth/auth-utils'
import { getGameResultsUrl } from '../games/action-creators'
import { graphql } from '../gql'
import { MaterialIcon } from '../icons/material/material-icon'
import { TextButton } from '../material/button'
import { LinkButton } from '../material/link-button'
import { useAppSelector } from '../redux-hooks'
import { getActivityDescriptor, NameBlock, NameLine } from '../social/friend-activity-status'
import { bodySmall, inter, labelMedium, singleLine, titleSmall } from '../styles/typography'
import { formatViewerCount, LiveLabel, useStreamUptime } from '../twitch/live-indicators'
import { LIVE_STREAMS_POLL_INTERVAL_MS, useQueryPolling } from '../twitch/live-state'
import { StaffBadgedAvatar } from '../users/staff-badge'
import { UsersState } from './chat-reducer'

/**
 * Both public "happening now" feeds in one operation. The channel's entries are whatever in these
 * feeds involves a channel member, worked out on the client, so a channel costs the same two
 * feed queries the home page already makes and never a per-member lookup.
 */
const ChannelActivityQuery = graphql(/* GraphQL */ `
  query ChannelActivity {
    liveStreams {
      twitchLogin
      title
      viewerCount
      user {
        id
        name
      }
    }
    liveGames {
      id
      startTime
      map {
        id
        name
      }
      config {
        __typename
        ... on GameConfigDataMatchmaking {
          gameSourceExtra {
            matchmakingType
          }
          teams {
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

export interface StreamActivityEntry {
  kind: 'stream'
  userId: SbUserId
  name: string
  twitchLogin: string
  title: string
  viewerCount: number
}

export interface GameActivityEntry {
  kind: 'game'
  gameId: string
  /** The channel members playing in this game, in team order. Never empty. */
  members: ReadonlyArray<{ id: SbUserId; name: string }>
  matchmakingType: MatchmakingType
  mapName: string
  /** When the game started, in unix ms. */
  startTime: number
}

export type ActivityEntry = StreamActivityEntry | GameActivityEntry

/** The channel's members: anyone in its active, idle or offline set counts. */
type ChannelMembers = ReadonlyDeep<Pick<UsersState, 'active' | 'idle' | 'offline'>>

function isMember(users: ChannelMembers, userId: SbUserId): boolean {
  return users.active.has(userId) || users.idle.has(userId) || users.offline.has(userId)
}

/**
 * Narrows the public feeds to what involves this channel: members' streams first (most watched
 * first), then live games with at least one member in them (newest first). The viewer's own stream
 * and game are left out; they know what they're doing.
 */
export function deriveActivityEntries(
  data: ChannelActivityData,
  users: ChannelMembers,
  selfUserId: SbUserId | undefined,
): ActivityEntry[] {
  const streams: StreamActivityEntry[] = []
  for (const stream of data.liveStreams) {
    if (!stream.user || stream.user.id === selfUserId || !isMember(users, stream.user.id)) {
      continue
    }
    streams.push({
      kind: 'stream',
      userId: stream.user.id,
      name: stream.user.name,
      twitchLogin: stream.twitchLogin,
      title: stream.title,
      viewerCount: stream.viewerCount,
    })
  }
  streams.sort((a, b) => b.viewerCount - a.viewerCount)

  const games: GameActivityEntry[] = []
  for (const game of data.liveGames) {
    if (game.config.__typename !== 'GameConfigDataMatchmaking') {
      continue
    }
    const players = game.config.teams.flat().flatMap(p => (p.user ? [p.user] : []))
    if (players.some(u => u.id === selfUserId)) {
      continue
    }
    const members = players.filter(u => isMember(users, u.id))
    if (!members.length) {
      continue
    }
    games.push({
      kind: 'game',
      gameId: game.id,
      members,
      matchmakingType: game.config.gameSourceExtra.matchmakingType,
      mapName: game.map.name,
      startTime: new Date(game.startTime).getTime(),
    })
  }
  games.sort((a, b) => b.startTime - a.startTime)

  return [...streams, ...games]
}

const PanelRoot = styled.section`
  flex-shrink: 0;
  padding: 8px;

  display: flex;
  flex-direction: column;

  background-color: var(--theme-container-low);
  border-radius: 8px;
  contain: content;
`

// Sized like the roster's first group header so the two columns share a rhythm.
const PanelTitle = styled.div`
  ${labelMedium};
  ${singleLine};
  height: 36px;
  padding: 0 8px;

  color: var(--theme-on-surface-variant);
  line-height: 36px;
`

// The same box as a roster row (avatar, 44px height, 8px side padding), so the panel reads as one
// more section of the member column and its names line up with the names beneath it.
const activityRow = css`
  ${titleSmall};
  height: 44px;
  padding: 4px 8px;

  display: flex;
  align-items: center;

  border-radius: 4px;
  color: inherit;
  text-decoration: none;
  contain: content;

  &:link,
  &:visited {
    color: inherit;
  }

  &:hover,
  &:focus-visible {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
    text-decoration: none;
    outline: none;
  }
`

const StreamRowRoot = styled.a`
  ${activityRow};
`

const GameRowRoot = styled(LinkButton)`
  ${activityRow};
`

const RowAvatar = styled(StaffBadgedAvatar)`
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  margin: 2px 16px 2px 0;
`

const MetaLine = styled.div`
  ${inter};
  ${bodySmall};

  display: flex;
  align-items: center;
  gap: 4px;
  line-height: 16px;
  white-space: nowrap;
  overflow: hidden;

  color: var(--theme-on-surface-variant);
`

const MetaIcon = styled(MaterialIcon)<{ $color?: string }>`
  flex-shrink: 0;
  color: ${props => props.$color ?? 'inherit'};
`

// `singleLine`'s ellipsis only applies to a block's own inline content, so the text needs its own
// element to truncate within the flex row.
const MetaText = styled.span`
  ${singleLine};
  min-width: 0;
`

const RowLiveLabel = styled(LiveLabel)`
  flex-shrink: 0;
  margin-left: 8px;
`

const Elapsed = styled.span`
  ${inter};
  ${bodySmall};
  flex-shrink: 0;
  margin-left: 8px;

  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

function StreamRow({ entry }: { entry: StreamActivityEntry }) {
  return (
    <StreamRowRoot href={`https://twitch.tv/${entry.twitchLogin}`} target='_blank' rel='noopener'>
      <RowAvatar userId={entry.userId} />
      <NameBlock>
        <NameLine>{entry.name}</NameLine>
        <MetaLine>
          <MetaIcon icon='visibility' size={14} />
          <MetaText>
            {formatViewerCount(entry.viewerCount)} · {entry.title}
          </MetaText>
        </MetaLine>
      </NameBlock>
      <RowLiveLabel />
    </StreamRowRoot>
  )
}

function GameRow({ entry }: { entry: GameActivityEntry }) {
  const { t } = useTranslation()
  // The stream uptime format ("1h 34m") is a plain elapsed-time format and fits a running game too.
  const elapsed = useStreamUptime(entry.startTime)
  // Borrows the friends list's "In game" glyph and color, so a game here and an "In game" line in
  // the roster below read as the same thing.
  const inGame = getActivityDescriptor(FriendActivityStatus.InGame, t)

  return (
    <GameRowRoot href={getGameResultsUrl(entry.gameId)}>
      <RowAvatar userId={entry.members[0].id} />
      <NameBlock>
        <NameLine>{entry.members.map(m => m.name).join(', ')}</NameLine>
        <MetaLine>
          {inGame ? <MetaIcon icon={inGame.icon} size={14} $color={inGame.color} /> : null}
          <MetaText>
            {matchmakingTypeToLabel(entry.matchmakingType, t)} · {entry.mapName}
          </MetaText>
        </MetaLine>
      </NameBlock>
      <Elapsed>{elapsed}</Elapsed>
    </GameRowRoot>
  )
}

const ToggleButton = styled(TextButton)`
  min-height: 36px;
  margin-top: 4px;
  align-self: stretch;
`

/** How many entries the panel shows before the rest sit behind a "Show n more" control. */
export const ACTIVITY_PANEL_DEFAULT_VISIBLE = 3

/**
 * The presentational Activity panel: members' live streams and games as compact rows, capped at
 * {@link ACTIVITY_PANEL_DEFAULT_VISIBLE} with an in-place expand/collapse for the rest. Renders
 * nothing with no entries. Expansion is component state, so remount (e.g. via `key`) to reset it.
 */
export function ActivityPanel({
  entries,
  className,
}: {
  entries: ReadonlyArray<ActivityEntry>
  className?: string
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  if (!entries.length) {
    return null
  }

  const hiddenCount = entries.length - ACTIVITY_PANEL_DEFAULT_VISIBLE
  const visible = expanded ? entries : entries.slice(0, ACTIVITY_PANEL_DEFAULT_VISIBLE)

  return (
    <PanelRoot className={className} aria-label={t('chat.activity.title', 'Activity')}>
      <PanelTitle>
        {t('chat.activity.title', 'Activity')} ({entries.length})
      </PanelTitle>
      {visible.map(entry =>
        entry.kind === 'stream' ? (
          <StreamRow key={`stream-${entry.userId}`} entry={entry} />
        ) : (
          <GameRow key={`game-${entry.gameId}`} entry={entry} />
        ),
      )}
      {hiddenCount > 0 ? (
        <ToggleButton
          label={
            expanded
              ? t('chat.activity.showLess', 'Show less')
              : t('chat.activity.showMore', 'Show {{count}} more', { count: hiddenCount })
          }
          iconStart={<MaterialIcon icon={expanded ? 'expand_less' : 'expand_more'} size={20} />}
          onClick={() => setExpanded(!expanded)}
        />
      ) : null}
    </PanelRoot>
  )
}

/**
 * The Activity panel for a channel: what its members are streaming and playing right now, from
 * the public live feeds intersected with the channel's member sets. Polls on the same cadence as
 * the home page's live sections while mounted.
 */
export function ChannelActivityPanel({
  channelId,
  className,
}: {
  channelId: SbChannelId
  className?: string
}) {
  const selfUserId = useSelfUser()?.id
  const channelUsers = useAppSelector(s => s.chat.idToUsers.get(channelId))
  const [{ data }, reexecuteQuery] = useQuery({
    query: ChannelActivityQuery,
    // Never suspend: this sits inside the channel page with no boundary of its own, and a stale or
    // missing panel is far better than a blanked chat while the feeds load.
    context: { ttl: 10 * 1000, suspense: false },
  })
  useQueryPolling(reexecuteQuery, LIVE_STREAMS_POLL_INTERVAL_MS)

  const entries = data && channelUsers ? deriveActivityEntries(data, channelUsers, selfUserId) : []

  // Keyed by channel so the expanded state doesn't follow the viewer from one channel to the next.
  return <ActivityPanel key={channelId} entries={entries} className={className} />
}
