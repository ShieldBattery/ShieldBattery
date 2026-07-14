import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { graphql } from '../gql'
import { BottomLinks } from '../home/bottom-links'
import { Markdown } from '../markdown/markdown'
import { CopyLinkButton } from '../navigation/copy-link-button'
import { push } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { useNow } from '../react/date-hooks'
import { CenteredContentContainer } from '../styles/centered-container'
import { bodyLarge, headlineLarge, headlineSmall, labelMedium } from '../styles/typography'
import { NewsImage, newsDateFormatter } from './news-image'

const NewsPostQuery = graphql(/* GraphQL */ `
  query NewsPost($id: UUID!) {
    newsPost(id: $id) {
      id
      title
      content
      publishedAt
      coverImageUrl
      coverImageSmallUrl
      author {
        id
        name
      }
    }
  }
`)

const Root = styled(CenteredContentContainer)`
  position: relative;

  display: grid;
  /* minmax so the track's auto minimum can't inflate past the container when content (e.g. a long
     title) has a large intrinsic width — 1fr alone means minmax(auto, 1fr). */
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(auto, 1fr) auto;

  --_header-height: 480px;

  @media (max-width: 1320px) {
    --_header-height: 280px;
  }
`

const HeaderImageContainer = styled.div`
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: var(--_header-height);
  z-index: -1;

  mask-image: linear-gradient(to top, transparent 16%, black 100%);
`

const HeaderImage = styled(NewsImage)`
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;

  opacity: 0.9;
`

const Content = styled.div`
  position: relative;
  padding-block: 16px;

  display: flex;
  flex-direction: column;
  align-items: center;

  gap: 16px;
`

const TitleRow = styled.div`
  margin-top: round(var(--_header-height) * 0.45, 1px);
  /* Without this cap the intrinsic size of a long title propagates up through this (also
     intrinsically-sized) box, letting TitleAndCopyLink's own max-width resolve against an
     already-overflowing parent instead of the real content width. */
  max-width: 100%;

  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
`

const TitleAndCopyLink = styled.div`
  position: relative;
  /* Reserve symmetric space for the copy-link button so the title text stays visually centered
     and the button can't extend past the content edge (and get clipped) when a long title makes
     this box span the full content width. The max-width keeps a long unbreakable word from
     inflating this box past the container (which would push the button offscreen again). */
  padding-inline: 56px;
  max-width: 100%;
`

const Title = styled.div`
  ${headlineLarge};
  text-align: center;
  overflow-wrap: break-word;
`

const PositionedCopyLinkButton = styled(CopyLinkButton)`
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
`

const DraftLabel = styled.div`
  ${labelMedium};
  padding: 2px 12px;

  border: 1px solid var(--theme-amber);
  border-radius: 12px;
  color: var(--theme-amber);
`

const PostDate = styled.div`
  ${headlineSmall};
  color: var(--theme-on-surface-variant);
  text-align: center;
`

const PostAuthor = styled.div`
  ${bodyLarge};
  color: var(--theme-on-surface-variant);
  text-align: center;
`

const StyledMarkdown = styled(Markdown)`
  width: 100%;
  max-width: 720px;
`

const ErrorText = styled.div`
  ${bodyLarge};
  padding: 48px 16px;

  color: var(--theme-error);
  text-align: center;
`

export function NewsPostPage({ params }: { params: { id: string } }) {
  const { t } = useTranslation()
  const [{ data, fetching, error }] = useQuery({
    query: NewsPostQuery,
    variables: { id: params.id },
  })

  const post = data?.newsPost
  const now = useNow(60_000)

  useEffect(() => {
    // A missing or (for non-admins) unpublished post resolves to null rather than an error, so send
    // the visitor home like the old static news page did on an invalid index.
    if (!fetching && data && !post) {
      push('/')
    }
  }, [fetching, data, post])

  if (error) {
    return <ErrorText>{t('news.unavailable', 'News is unavailable right now.')}</ErrorText>
  }
  if (!post) {
    return <LoadingDotsArea />
  }

  const isDraft = !post.publishedAt || new Date(post.publishedAt).getTime() > now

  return (
    <Root>
      <HeaderImageContainer>
        <HeaderImage
          id={post.id}
          coverImageUrl={post.coverImageUrl}
          coverImageSmallUrl={post.coverImageSmallUrl}
        />
      </HeaderImageContainer>
      <Content>
        <TitleRow>
          {isDraft ? <DraftLabel>{t('news.draft', 'Draft')}</DraftLabel> : null}
          <TitleAndCopyLink>
            <Title data-test='news-post-title'>{post.title}</Title>
            <PositionedCopyLinkButton
              tooltipPosition='right'
              startingText={t('news.copyLink', 'Copy link to news post')}
            />
          </TitleAndCopyLink>
        </TitleRow>
        {post.publishedAt ? (
          <PostDate>{newsDateFormatter.format(new Date(post.publishedAt))}</PostDate>
        ) : null}
        {post.author ? (
          <PostAuthor>
            {t('news.byAuthor', {
              defaultValue: 'by {{name}}',
              name: post.author.name,
            })}
          </PostAuthor>
        ) : null}
        <StyledMarkdown source={post.content} allowMedia={true} />
      </Content>

      <BottomLinks />
    </Root>
  )
}
