import { ResultOf } from '@graphql-typed-document-node/core'
import { ReactNode, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Link } from 'wouter'
import { urlPath } from '../../common/urls'
import { FragmentType, graphql, useFragment } from '../gql'
import { HomeSection, HomeSectionTitle } from '../home/home-section'
import { useButtonState } from '../material/button'
import { LinkButton } from '../material/link-button'
import { Ripple } from '../material/ripple'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { bodyMedium, singleLine, titleMedium, titleSmall } from '../styles/typography'
import { useLastSeenNewsPost } from './last-seen-news-post'
import { NewsImage, newsDateFormatter } from './news-image'

export const News_HomeFeedFragment = graphql(/* GraphQL */ `
  fragment News_HomeFeedFragment on Query {
    newsPosts(first: 10) {
      edges {
        node {
          id
          title
          summary
          publishedAt
          coverImageUrl
          coverImageSmallUrl
        }
      }
    }
  }
`)

type NewsFeedPost = ResultOf<typeof News_HomeFeedFragment>['newsPosts']['edges'][number]['node']

const SectionHeader = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
`

const SeeAllLink = styled(Link)`
  ${bodyMedium};
  flex-shrink: 0;

  font-weight: 600;
  text-decoration: none;

  &,
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

const UnavailableText = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const OneUpEntry = styled(NewsPreview)`
  ${containerStyles(ContainerLevel.Low)};

  width: 100%;
  height: auto;
  max-height: calc(var(--_dummy, 100%) * 3px / 5 * 3 / 2);

  display: grid;
  grid-auto-rows: min-content;
  grid-template-columns: repeat(5, 1fr);

  border-radius: 4px;
  contain: content;

  --_image-aspect-ratio: 3 / 2;
  --_image-grid-column: span 3;
  --_text-grid-column: span 2;

  @media (max-width: 1000px) {
    --_image-aspect-ratio: 16 / 9;
    --_image-grid-column: span 5;
    --_text-grid-column: span 5;
  }
`

const TwoUpEntries = styled.div`
  width: 100%;
  display: flex;
  gap: 16px;
`

const TwoUpEntry = styled(NewsPreview)`
  ${containerStyles(ContainerLevel.Low)};

  width: 100%;
  flex-grow: 0;
  flex-shrink: 1;

  display: grid;
  grid-template-columns: 1fr;

  border-radius: 4px;
  contain: content;

  --_image-aspect-ratio: 16 / 9;
  --_image-grid-column: span 1;
  --_text-grid-column: span 1;
  --_summary_display: none;
`

const EntryPreviewImageContainer = styled.div`
  aspect-ratio: var(--_image-aspect-ratio);
  grid-column: var(--_image-grid-column);
  max-width: 100%;
  height: auto;

  background-color: var(--color-grey-blue30);
  contain: content;
  overflow: hidden;

  & > img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`

const EntryPreviewText = styled.div`
  height: 100%;
  grid-column: var(--_text-grid-column);
  padding: 12px 16px;

  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: hidden;
`

const EntryPreviewDate = styled.div`
  ${titleSmall};
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
`

const EntryPreviewTitle = styled.div`
  ${titleMedium};

  flex-shrink: 0;

  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  overflow: hidden;

  @media (max-width: 1176px) {
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
`

const EntryPreviewSummary = styled.div`
  ${bodyMedium};
  --_line-height: 20;

  flex-grow: 1;
  flex-shrink: 1;

  display: var(--_entry-summary-display);

  color: var(--theme-on-surface-variant);
  container-type: size;
  overflow: hidden;

  @media (max-width: 1000px) {
    display: none;
  }
`

const EntryPreviewSummaryText = styled.div`
  /** NOTE(tec27): The tan/atan is a hacky way to strip the unit from a value */
  --resolved-length: 100cqh;
  --_line-clamp: round(down, tan(atan2(var(--resolved-length) / var(--_line-height), 1px)), 1);

  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: var(--_line-clamp);
  line-clamp: var(--_line-clamp);
  overflow: hidden;

  @container (max-height: ${20 * 1 - 1}px) {
    & {
      display: none;
    }
  }
`

const RemainingEntriesList = styled.div`
  display: grid;
  grid-template-columns: max-content 1fr;

  align-items: baseline;
  column-gap: 16px;
`

export function NewsFeed({
  query,
  hasError,
}: {
  query?: FragmentType<typeof News_HomeFeedFragment>
  hasError?: boolean
}) {
  const { t } = useTranslation()
  const data = useFragment(News_HomeFeedFragment, query)
  const posts = data?.newsPosts.edges.map(e => e.node) ?? []

  const primary = posts[0]
  const twoUp = posts.slice(1, 3)
  const remaining = posts.slice(3, 10)

  const [lastSeenNewsPost, markNewsPostSeen] = useLastSeenNewsPost()
  useEffect(() => {
    if (primary && primary.id !== lastSeenNewsPost) {
      markNewsPostSeen(primary.id)
    }
  }, [lastSeenNewsPost, markNewsPostSeen, primary])

  let body: ReactNode = null
  if (posts.length > 0) {
    body = (
      <Root>
        <OneUpEntry data-test='news-feed-primary' post={primary} />

        {twoUp.length > 0 ? (
          <TwoUpEntries>
            {twoUp.map(post => (
              <TwoUpEntry key={post.id} post={post} />
            ))}
          </TwoUpEntries>
        ) : null}

        {remaining.length > 0 ? (
          <RemainingEntriesList>
            {remaining.map(post => (
              <RemainingEntry key={post.id} post={post} />
            ))}
          </RemainingEntriesList>
        ) : null}
      </Root>
    )
  } else if (hasError) {
    body = (
      <UnavailableText>{t('news.unavailable', 'News is unavailable right now.')}</UnavailableText>
    )
  }

  return (
    <HomeSection>
      <SectionHeader>
        <HomeSectionTitle data-test='latest-news-title'>
          {t('home.latestNewsTitle', 'Latest news')}
        </HomeSectionTitle>
        {posts.length > 0 ? (
          <SeeAllLink href='/news'>{t('news.seeAll', 'See all news')}</SeeAllLink>
        ) : null}
      </SectionHeader>

      {body}
    </HomeSection>
  )
}

function NewsPreview({
  post,
  className,
  ...rest
}: {
  post: NewsFeedPost
  className?: string
  'data-test'?: string
}) {
  const [buttonProps, rippleRef] = useButtonState({})

  return (
    <LinkButton {...buttonProps} {...rest} className={className} href={urlPath`/news/${post.id}`}>
      <EntryPreviewImageContainer>
        <NewsImage
          id={post.id}
          coverImageUrl={post.coverImageUrl}
          coverImageSmallUrl={post.coverImageSmallUrl}
        />
      </EntryPreviewImageContainer>
      <EntryPreviewText>
        <EntryPreviewDate>
          {post.publishedAt ? newsDateFormatter.format(new Date(post.publishedAt)) : ''}
        </EntryPreviewDate>
        <EntryPreviewTitle>{post.title}</EntryPreviewTitle>
        <EntryPreviewSummary>
          <EntryPreviewSummaryText>{post.summary}</EntryPreviewSummaryText>
        </EntryPreviewSummary>
      </EntryPreviewText>
      <Ripple ref={rippleRef} />
    </LinkButton>
  )
}

const RemainingEntryRoot = styled(LinkButton)`
  position: relative;

  margin-inline: -8px;
  padding-block: 4px;
  padding-inline: 8px;

  display: grid;
  grid-template-columns: subgrid;
  grid-column: span 2;

  align-items: baseline;
  border-radius: 4px;
`

const RemainingEntryDate = styled.div`
  ${titleSmall};

  grid-column: 1;

  color: var(--theme-on-surface-variant);
  text-align: right;
`

const RemainingEntryTitle = styled.div`
  ${titleMedium};
  ${singleLine};

  grid-column: 2;
`

function RemainingEntry({ post }: { post: NewsFeedPost }) {
  const [buttonProps, rippleRef] = useButtonState({})

  return (
    <RemainingEntryRoot {...buttonProps} href={urlPath`/news/${post.id}`}>
      <RemainingEntryDate>
        {post.publishedAt ? newsDateFormatter.format(new Date(post.publishedAt)) : ''}
      </RemainingEntryDate>
      <RemainingEntryTitle>{post.title}</RemainingEntryTitle>
      <Ripple ref={rippleRef} />
    </RemainingEntryRoot>
  )
}
