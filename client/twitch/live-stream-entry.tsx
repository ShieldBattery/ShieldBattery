import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { FragmentType, graphql, useFragment } from '../gql'
import { bodySmall, singleLine, titleSmall } from '../styles/typography'

/**
 * Shared fragment for the home-page "live streams" feed. Defined here (rather than duplicated in
 * each consumer) so codegen sees a single definition.
 */
export const LiveStreams_FeedFragment = graphql(/* GraphQL */ `
  fragment LiveStreams_FeedFragment on Query {
    liveStreams {
      twitchLogin
      ...LiveStreams_FeedEntryFragment
    }
  }
`)

const LiveStreams_FeedEntryFragment = graphql(/* GraphQL */ `
  fragment LiveStreams_FeedEntryFragment on LiveStream {
    twitchLogin
    twitchDisplayName
    title
    gameName
    viewerCount
    thumbnailUrl
    user {
      id
      name
    }
  }
`)

const EntryRoot = styled.a`
  display: flex;
  align-items: center;
  gap: 12px;
  height: 72px;
  padding: 8px;

  color: inherit;
  text-decoration: none;
  contain: content;

  &:link,
  &:visited {
    color: inherit;
  }

  &:hover,
  &:focus-visible {
    background-color: var(--theme-container-high);
    outline: none;
  }
`

const Thumbnail = styled.img`
  width: 96px;
  height: 54px;
  flex-shrink: 0;

  border-radius: 2px;
  object-fit: cover;
  background-color: var(--theme-container-highest);
`

const Info = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const Title = styled.div`
  ${titleSmall};
  ${singleLine};
`

const StreamerName = styled.div`
  ${bodySmall};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const Meta = styled.div`
  ${bodySmall};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

export function LiveStreamEntry({
  query,
}: {
  query: FragmentType<typeof LiveStreams_FeedEntryFragment>
}) {
  const { t } = useTranslation()
  const stream = useFragment(LiveStreams_FeedEntryFragment, query)
  const streamerName = stream.user?.name ?? stream.twitchDisplayName

  return (
    <EntryRoot href={`https://twitch.tv/${stream.twitchLogin}`} target='_blank' rel='noopener'>
      <Thumbnail src={stream.thumbnailUrl} alt='' width={96} height={54} loading='lazy' />
      <Info>
        <Title>{stream.title}</Title>
        <StreamerName>{streamerName}</StreamerName>
        <Meta>
          {t('twitch.liveStreams.viewers', '{{count}} watching', { count: stream.viewerCount })}
          {' · '}
          {stream.gameName}
        </Meta>
      </Info>
    </EntryRoot>
  )
}
