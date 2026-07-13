import { ResultOf } from '@graphql-typed-document-node/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { graphql } from '../gql'
import { OutlinedButton, useButtonState } from '../material/button'
import { LinkButton } from '../material/link-button'
import { Ripple } from '../material/ripple'
import { LoadingDotsArea } from '../progress/dots'
import { CenteredContentContainer } from '../styles/centered-container'
import { ContainerLevel, containerStyles } from '../styles/colors'
import {
  bodyLarge,
  bodyMedium,
  headlineMedium,
  titleMedium,
  titleSmall,
} from '../styles/typography'
import { newsDateFormatter } from './news-image'
import { urlForNewsPost } from './news-url'

const NewsArchiveQuery = graphql(/* GraphQL */ `
  query NewsArchive($first: Int, $after: String) {
    newsPosts(first: $first, after: $after) {
      edges {
        node {
          id
          title
          summary
          publishedAt
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`)

type NewsArchivePost = ResultOf<typeof NewsArchiveQuery>['newsPosts']['edges'][number]['node']

const PAGE_SIZE = 20

const Root = styled(CenteredContentContainer)`
  padding-block: 24px 48px;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const PageTitle = styled.div`
  ${headlineMedium};
`

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
`

const LoadMoreRow = styled.div`
  display: flex;
  justify-content: center;
  padding: 12px;
`

const EntryRoot = styled(LinkButton)`
  ${containerStyles(ContainerLevel.Low)};

  padding: 16px;

  display: flex;
  flex-direction: column;
  gap: 4px;

  border-radius: 4px;
  contain: content;
`

const EntryDate = styled.div`
  ${titleSmall};
  color: var(--theme-on-surface-variant);
`

const EntryTitle = styled.div`
  ${titleMedium};
`

const EntrySummary = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

export function NewsArchivePage() {
  const { t } = useTranslation()
  // One `after` cursor per loaded page (the first page has none). We page with cursors rather than
  // growing `first`, because the server clamps `first` to 100.
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null])

  return (
    <Root>
      <PageTitle>{t('news.archive.title', 'News')}</PageTitle>
      <List>
        {pageCursors.map((cursor, i) => (
          <NewsArchiveChunk
            key={cursor ?? 'first'}
            after={cursor}
            isLastPage={i === pageCursors.length - 1}
            onLoadMore={endCursor => setPageCursors(prev => [...prev, endCursor])}
          />
        ))}
      </List>
    </Root>
  )
}

function NewsArchiveChunk({
  after,
  isLastPage,
  onLoadMore,
}: {
  after: string | null
  isLastPage: boolean
  onLoadMore: (endCursor: string) => void
}) {
  const { t } = useTranslation()
  const [{ data, fetching, error }] = useQuery({
    query: NewsArchiveQuery,
    variables: { first: PAGE_SIZE, after: after ?? undefined },
    requestPolicy: 'cache-and-network',
  })

  const posts = data?.newsPosts.edges.map(e => e.node) ?? []
  const pageInfo = data?.newsPosts.pageInfo

  return (
    <>
      {posts.map(post => (
        <NewsArchiveEntry key={post.id} post={post} />
      ))}
      {fetching && !data ? <LoadingDotsArea /> : null}
      {error ? (
        <ErrorText>{t('news.archive.error', 'News is unavailable right now.')}</ErrorText>
      ) : null}
      {isLastPage && pageInfo?.hasNextPage && pageInfo.endCursor ? (
        <LoadMoreRow>
          <OutlinedButton
            label={t('news.archive.loadMore', 'Load more')}
            onClick={() => onLoadMore(pageInfo.endCursor!)}
          />
        </LoadMoreRow>
      ) : null}
    </>
  )
}

function NewsArchiveEntry({ post }: { post: NewsArchivePost }) {
  const [buttonProps, rippleRef] = useButtonState({})

  return (
    <EntryRoot {...buttonProps} href={urlForNewsPost(post.id, post.title)}>
      <EntryDate>
        {post.publishedAt ? newsDateFormatter.format(new Date(post.publishedAt)) : ''}
      </EntryDate>
      <EntryTitle>{post.title}</EntryTitle>
      <EntrySummary>{post.summary}</EntrySummary>
      <Ripple ref={rippleRef} />
    </EntryRoot>
  )
}
