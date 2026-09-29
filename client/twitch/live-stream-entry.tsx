import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ConnectedAvatar } from '../avatars/avatar'
import { FragmentType, graphql, useFragment } from '../gql'
import { useFormatLocale } from '../i18n/locale-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { EllipsizedText } from '../material/ellipsized-text'
import { bodyMedium, bodySmall, labelSmall, singleLine, titleSmall } from '../styles/typography'
import {
  formatViewerCount,
  LiveDot,
  LivePill,
  TwitchMark,
  UptimePill,
  useStreamUptime,
  ViewerCountPill,
} from './live-indicators'
import { LiveStreamModeration, ModerationContainer } from './live-stream-moderation'

/**
 * Shared fragment for the home-page "live streams" feed. Defined here (rather than duplicated in
 * each consumer) so codegen sees a single definition.
 */
export const LiveStreams_FeedFragment = graphql(/* GraphQL */ `
  fragment LiveStreams_FeedFragment on Query {
    liveStreams {
      twitchLogin
      viewerCount
      ...LiveStreams_FeedEntryFragment
    }
  }
`)

const LiveStreams_FeedEntryFragment = graphql(/* GraphQL */ `
  fragment LiveStreams_FeedEntryFragment on LiveStream {
    id
    twitchLogin
    twitchDisplayName
    title
    viewerCount
    startedAt
    thumbnailUrl
    user {
      id
      name
    }
  }
`)

type LiveStreamFragment = ReturnType<typeof useLiveStream>

function useLiveStream(query: FragmentType<typeof LiveStreams_FeedEntryFragment>) {
  return useFragment(LiveStreams_FeedEntryFragment, query)
}

/**
 * The ShieldBattery identity leads every entry: the SB username. The Twitch handle is only worth
 * showing when it differs from the SB name.
 */
function getIdentity(stream: LiveStreamFragment) {
  const sbName = stream.user?.name ?? stream.twitchDisplayName
  const handle =
    stream.user && stream.twitchDisplayName.toLowerCase() !== stream.user.name.toLowerCase()
      ? stream.twitchDisplayName
      : undefined
  return { sbName, handle }
}

function streamUrl(login: string) {
  return `https://twitch.tv/${login}`
}

const Name = styled.span`
  ${singleLine};
  color: var(--theme-on-surface);
`

const Handle = styled.span`
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const Thumbnail = styled.img`
  display: block;
  width: 100%;
  height: 100%;

  object-fit: cover;
  background-color: var(--theme-container-highest);
`

// --- Featured (hero) entry -------------------------------------------------------------------

const FeaturedRoot = styled.a`
  display: block;
  padding: 10px 10px 12px;

  color: inherit;
  text-decoration: none;
  contain: content;

  &:link,
  &:visited {
    color: inherit;
  }

  &:hover,
  &:focus-visible {
    text-decoration: none;
    outline: none;
  }
`

const FeaturedThumb = styled.div`
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;

  border-radius: 6px;
  overflow: hidden;

  ${FeaturedRoot}:hover &,
  ${FeaturedRoot}:focus-visible &,
  ${ModerationContainer}:hover & {
    outline: 2px solid var(--theme-live);
    outline-offset: 2px;
  }
`

const CornerTopLeft = styled.div`
  position: absolute;
  top: 8px;
  left: 8px;
`
const CornerTopRight = styled.div`
  position: absolute;
  top: 8px;
  right: 8px;
`
const CornerBottomLeft = styled.div`
  position: absolute;
  bottom: 8px;
  left: 8px;
`
const CornerBottomRight = styled.div`
  position: absolute;
  bottom: 8px;
  right: 8px;
`

const FeaturedMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
`

const FeaturedAvatar = styled(ConnectedAvatar)`
  width: 34px;
  height: 34px;
  flex-shrink: 0;
`

const MetaText = styled.div`
  min-width: 0;
  flex: 1;
`

const NameLine = styled.div`
  ${titleSmall};
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
`

const FeaturedTitle = styled.div`
  ${bodyMedium};
  ${singleLine};
  margin-top: 1px;
  color: var(--theme-on-surface-variant);
`

export function FeaturedLiveStreamEntry({
  query,
}: {
  query: FragmentType<typeof LiveStreams_FeedEntryFragment>
}) {
  const stream = useLiveStream(query)
  const { sbName, handle } = getIdentity(stream)

  const entry = (
    <FeaturedRoot href={streamUrl(stream.twitchLogin)} target='_blank' rel='noopener'>
      <FeaturedThumb>
        <Thumbnail src={stream.thumbnailUrl} alt='' loading='lazy' />
        <CornerTopLeft>
          <LivePill />
        </CornerTopLeft>
        <CornerTopRight>
          <ViewerCountPill count={stream.viewerCount} />
        </CornerTopRight>
        <CornerBottomLeft>
          <UptimePill startedAt={stream.startedAt} />
        </CornerBottomLeft>
        <CornerBottomRight>
          <TwitchMark />
        </CornerBottomRight>
      </FeaturedThumb>
      <FeaturedMeta>
        {stream.user ? <FeaturedAvatar userId={stream.user.id} /> : null}
        <MetaText>
          <NameLine>
            <Name>{sbName}</Name>
            {handle ? <Handle>@{handle}</Handle> : null}
          </NameLine>
          <FeaturedTitle>{stream.title}</FeaturedTitle>
        </MetaText>
      </FeaturedMeta>
    </FeaturedRoot>
  )

  return stream.user ? (
    <LiveStreamModeration userId={stream.user.id} name={sbName} placement='below-top-pills'>
      {entry}
    </LiveStreamModeration>
  ) : (
    entry
  )
}

// --- Compact row entry -----------------------------------------------------------------------

const RowRoot = styled.a`
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 8px 12px;

  color: inherit;
  text-decoration: none;
  contain: content;

  &:link,
  &:visited {
    color: inherit;
  }

  &:hover,
  &:focus-visible,
  ${ModerationContainer}:hover & {
    background-color: var(--theme-container-high);
    text-decoration: none;
    outline: none;
  }
`

const RowThumb = styled.div`
  position: relative;
  width: 108px;
  height: 61px;
  flex-shrink: 0;

  border-radius: 4px;
  overflow: hidden;
`

const RowViewerCorner = styled.div`
  position: absolute;
  bottom: 5px;
  right: 5px;
`

const RowInfo = styled.div`
  min-width: 0;
  flex: 1;
`

const RowNameLine = styled.div`
  ${titleSmall};
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
`

const RowTitle = styled.div`
  ${bodyMedium};
  ${singleLine};
  margin-top: 2px;
`

const RowMeta = styled.div`
  ${bodySmall};
  ${singleLine};
  margin-top: 2px;
  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

export function LiveStreamEntry({
  query,
}: {
  query: FragmentType<typeof LiveStreams_FeedEntryFragment>
}) {
  const stream = useLiveStream(query)
  const { sbName, handle } = getIdentity(stream)
  const uptime = useStreamUptime(stream.startedAt)

  const entry = (
    <RowRoot href={streamUrl(stream.twitchLogin)} target='_blank' rel='noopener'>
      <RowThumb>
        <Thumbnail src={stream.thumbnailUrl} alt='' width={108} height={61} loading='lazy' />
        <RowViewerCorner>
          <ViewerCountPill count={stream.viewerCount} />
        </RowViewerCorner>
      </RowThumb>
      <RowInfo>
        <RowNameLine>
          <LiveDot $size={7} />
          <Name>{sbName}</Name>
          {handle ? <Handle>@{handle}</Handle> : null}
        </RowNameLine>
        <RowTitle>{stream.title}</RowTitle>
        <RowMeta>{uptime}</RowMeta>
      </RowInfo>
    </RowRoot>
  )

  return stream.user ? (
    <LiveStreamModeration userId={stream.user.id} name={sbName}>
      {entry}
    </LiveStreamModeration>
  ) : (
    entry
  )
}

// --- Mini row entry --------------------------------------------------------------------------

const MiniRoot = styled.a`
  height: 52px;
  padding: 0 8px;

  display: flex;
  align-items: center;
  gap: 12px;

  border-radius: 4px;
  color: inherit;
  text-decoration: none;
  contain: content;

  &:link,
  &:visited {
    color: inherit;
  }

  &:hover,
  &:focus-visible,
  ${ModerationContainer}:hover & {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
    text-decoration: none;
    outline: none;
  }
`

const MiniThumb = styled.div`
  position: relative;
  width: 64px;
  height: 36px;
  flex-shrink: 0;

  border-radius: 4px;
  overflow: hidden;
`

const MiniLiveBadge = styled.div`
  ${labelSmall};
  position: absolute;
  top: 3px;
  left: 3px;
  height: 12px;
  padding: 0 3px;

  display: flex;
  align-items: center;

  border-radius: 3px;
  background-color: var(--theme-live);
  color: #fff;
  font-size: 9px;
  line-height: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`

const MiniInfo = styled.div`
  min-width: 0;
  flex: 1;

  display: flex;
  flex-direction: column;
`

const MiniLine = styled.div`
  height: 20px;

  display: flex;
  align-items: center;
  gap: 8px;
`

const MiniName = styled(EllipsizedText)`
  ${titleSmall};
  flex: 1;
`

const MiniTitle = styled(EllipsizedText)`
  ${bodySmall};
  flex: 1;
  color: var(--theme-on-surface-variant);
`

const MiniUptime = styled.span`
  ${bodySmall};
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

const MiniViewers = styled.div`
  ${bodySmall};
  flex-shrink: 0;

  display: flex;
  align-items: center;
  gap: 2px;

  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

const MiniViewersIcon = styled(MaterialIcon).attrs({ icon: 'visibility', size: 14 })`
  color: var(--theme-live);
`

/**
 * The smallest stream entry, for narrow side columns: a small thumbnail, then the streamer and
 * viewer count over the stream title and uptime.
 */
export function MiniLiveStreamEntry({
  query,
}: {
  query: FragmentType<typeof LiveStreams_FeedEntryFragment>
}) {
  const { t } = useTranslation()
  const locale = useFormatLocale()
  const stream = useLiveStream(query)
  const { sbName } = getIdentity(stream)
  const uptime = useStreamUptime(stream.startedAt)

  const entry = (
    <MiniRoot href={streamUrl(stream.twitchLogin)} target='_blank' rel='noopener'>
      <MiniThumb>
        <Thumbnail src={stream.thumbnailUrl} alt='' width={64} height={36} loading='lazy' />
        <MiniLiveBadge>{t('twitch.live.badge', 'Live')}</MiniLiveBadge>
      </MiniThumb>
      <MiniInfo>
        <MiniLine>
          <MiniName text={sbName} />
          <MiniViewers
            aria-label={t('twitch.live.viewerCount', {
              defaultValue_one: '{{count}} viewer',
              defaultValue_other: '{{count}} viewers',
              count: stream.viewerCount,
            })}>
            <MiniViewersIcon />
            {formatViewerCount(stream.viewerCount, locale)}
          </MiniViewers>
        </MiniLine>
        <MiniLine>
          <MiniTitle text={stream.title} />
          <MiniUptime>{uptime}</MiniUptime>
        </MiniLine>
      </MiniInfo>
    </MiniRoot>
  )

  return stream.user ? (
    <LiveStreamModeration userId={stream.user.id} name={sbName}>
      {entry}
    </LiveStreamModeration>
  ) : (
    entry
  )
}
