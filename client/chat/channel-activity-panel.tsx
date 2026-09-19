import { ResultOf } from '@graphql-typed-document-node/core'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { useQuery } from 'urql'
import { SbChannelId } from '../../common/chat'
import { MatchmakingType, matchmakingTypeToLabel } from '../../common/matchmaking'
import { SbUserId } from '../../common/users/sb-user-id'
import { useSelfUser } from '../auth/auth-utils'
import { AvatarStack } from '../avatars/avatar-stack'
import { getGameResultsUrl } from '../games/action-creators'
import { graphql } from '../gql'
import { UploadedMapImage } from '../maps/map-image'
import { LinkButton } from '../material/link-button'
import { useAppSelector } from '../redux-hooks'
import { bodySmall, inter, labelMedium, singleLine } from '../styles/typography'
import { useStreamUptime } from '../twitch/live-indicators'
import { LIVE_STREAMS_POLL_INTERVAL_MS, useQueryPolling } from '../twitch/live-state'
import { FeaturedLiveStreamEntry, LiveStreamEntry } from '../twitch/live-stream-entry'
import { UsersState } from './chat-reducer'

/**
 * Both public "happening now" feeds in one operation. Streams reuse the home page's feed fragment
 * so the same cards can render here. The channel's entries are whatever in these feeds involves a
 * channel member, worked out on the client, so a channel costs the same two feed queries the home
 * page already makes and never a per-member lookup.
 */
const ChannelActivityQuery = graphql(/* GraphQL */ `
  query ChannelActivity {
    liveStreams {
      twitchLogin
      viewerCount
      user {
        id
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
            user {
              id
            }
          }
        }
      }
    }
  }
`)

type ChannelActivityData = ResultOf<typeof ChannelActivityQuery>
type LiveStreamItem = ChannelActivityData['liveStreams'][number]

export interface GameActivityEntry {
  gameId: string
  /** The channel members playing in this game, in team order. Never empty. */
  members: ReadonlyArray<SbUserId>
  matchmakingType: MatchmakingType
  /** When the game started, in unix ms. */
  startTime: number
  map: ChannelActivityData['liveGames'][number]['map']
}

/** The channel's members: anyone in its active, idle or offline set counts. */
type ChannelMembers = ReadonlyDeep<Pick<UsersState, 'active' | 'idle' | 'offline'>>

function isMember(users: ChannelMembers, userId: SbUserId): boolean {
  return users.active.has(userId) || users.idle.has(userId) || users.offline.has(userId)
}

interface DerivedActivity {
  streams: LiveStreamItem[]
  games: GameActivityEntry[]
}

/**
 * Narrows the public feeds to what involves this channel: members' streams (most watched first),
 * then live games with at least one member in them (newest first). The viewer's own stream and
 * game are left out; they know what they're doing.
 */
export function deriveActivityEntries(
  data: ChannelActivityData,
  users: ChannelMembers,
  selfUserId: SbUserId | undefined,
): DerivedActivity {
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
    const players = game.config.teams.flat().flatMap(p => (p.user ? [p.user] : []))
    if (players.some(u => u.id === selfUserId)) {
      continue
    }
    const members = players.filter(u => isMember(users, u.id)).map(u => u.id)
    if (!members.length) {
      continue
    }
    games.push({
      gameId: game.id,
      members,
      matchmakingType: game.config.gameSourceExtra.matchmakingType,
      startTime: new Date(game.startTime).getTime(),
      map: game.map,
    })
  }
  games.sort((a, b) => b.startTime - a.startTime)

  return { streams, games }
}

// The roster below is the column's main content, so it always keeps at least 40% of the column:
// past that the panel's entries scroll. Featured stream cards are tall, so the height cap is the
// limit instead of a numeric entry count.
const PanelRoot = styled.section`
  flex-shrink: 0;
  max-height: 60%;

  display: flex;
  flex-direction: column;

  background-color: var(--theme-container-low);
  border-radius: 8px;
  contain: content;
`

const EntryList = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  padding-bottom: 8px;

  display: flex;
  flex-direction: column;

  overflow-y: auto;
`

// Same inset as the roster's group headers: 8px margin + 8px padding, so the label lines up with
// "Active" / "Idle" below and the panel's scrollbar sits on the same edge as the roster's.
const panelHeader = css`
  ${labelMedium};
  ${singleLine};
  flex-shrink: 0;
  margin: 0 8px;
  padding: 0 8px;

  color: var(--theme-on-surface-variant);
  line-height: 36px;
`

const SectionHeader = styled.div`
  ${panelHeader};
  height: 44px;
  padding-top: 8px;
`

// Home stream cards bring their own padding (10/12px) for the home column. Pull them onto the
// roster's 8px grid so a featured card, a compact row, a match row, and a user-list row share one
// gutter — and so the hover wells line up.
const StreamSlot = styled.div`
  margin: 0 8px;

  a {
    padding: 8px;
    gap: 8px;
  }
`

const MatchRoot = styled(LinkButton)`
  flex-shrink: 0;
  margin: 0 8px;
  padding: 8px;

  display: flex;
  align-items: center;
  gap: 8px;

  border-radius: 4px;
  color: inherit;
  text-decoration: none;
  /* The stack's overlap ring has to be opaque and match whatever it sits on. */
  --sb-avatar-stack-ring: var(--theme-container-low);

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

const MatchMap = styled(UploadedMapImage)`
  width: 48px;
  height: 48px;
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

const MatchMapFallback = styled.div`
  width: 48px;
  height: 48px;
  flex-shrink: 0;

  border-radius: 4px;
  background-color: var(--theme-container-highest);
`

const MatchBody = styled.div`
  flex: 1;
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 4px;
`

const MatchMeta = styled.div`
  ${inter};
  ${bodySmall};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

/**
 * A match, not a broadcast: map thumbnail + the members as an avatar stack (names in a tooltip,
 * +N if they don't all fit), then mode and elapsed time. No written map name — the thumbnail is
 * the map.
 */
function GameMatchRow({ entry }: { entry: GameActivityEntry }) {
  const { t } = useTranslation()
  const elapsed = useStreamUptime(entry.startTime)

  return (
    <MatchRoot href={getGameResultsUrl(entry.gameId)}>
      <MatchMap map={entry.map} size={48} forceAspectRatio={1} noImageElem={<MatchMapFallback />} />
      <MatchBody>
        <AvatarStack userIds={entry.members} size={24} max={4} showNamesTooltip />
        <MatchMeta>
          {matchmakingTypeToLabel(entry.matchmakingType, t)} · {elapsed}
        </MatchMeta>
      </MatchBody>
    </MatchRoot>
  )
}

/**
 * The presentational Activity panel: one featured stream (most watched) with the rest as compact
 * rows — the home page's live-streams feed — then a separate in-game group. Renders nothing with
 * no entries. The panel's 60% height cap is the only limit; entries scroll inside it.
 */
export function ActivityPanel({
  streams,
  games,
  className,
}: {
  streams: ReadonlyArray<LiveStreamItem>
  games: ReadonlyArray<GameActivityEntry>
  className?: string
}) {
  const { t } = useTranslation()
  const count = streams.length + games.length

  if (!count) {
    return null
  }

  const [featured, ...rest] = streams

  return (
    <PanelRoot className={className} aria-label={t('chat.activity.title', 'Activity')}>
      <SectionHeader>
        {t('chat.activity.title', 'Activity')} ({count})
      </SectionHeader>
      <EntryList>
        {featured ? (
          <StreamSlot>
            <FeaturedLiveStreamEntry query={featured} />
          </StreamSlot>
        ) : null}
        {rest.map(stream => (
          <StreamSlot key={stream.twitchLogin}>
            <LiveStreamEntry query={stream} />
          </StreamSlot>
        ))}
        {games.length ? (
          <>
            <SectionHeader>
              {t('chat.activity.inGame', 'In game ({{count}})', { count: games.length })}
            </SectionHeader>
            {games.map(game => (
              <GameMatchRow key={game.gameId} entry={game} />
            ))}
          </>
        ) : null}
      </EntryList>
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

  const { streams, games } =
    data && channelUsers
      ? deriveActivityEntries(data, channelUsers, selfUserId)
      : { streams: [], games: [] }

  return <ActivityPanel streams={streams} games={games} className={className} />
}
