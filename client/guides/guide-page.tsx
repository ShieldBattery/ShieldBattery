import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useTrackPageView } from '../analytics/analytics'
import { BottomLinks } from '../home/bottom-links'
import { CopyLinkButton } from '../navigation/copy-link-button'
import { NewsMarkdown } from '../news/news-markdown'
import { CenteredContentContainer } from '../styles/centered-container'
import { headlineLarge } from '../styles/typography'

const Root = styled(CenteredContentContainer)`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(auto, 1fr) auto;
`

const Article = styled.article`
  width: 100%;
  max-width: 720px;
  margin-inline: auto;
  padding-block: 32px 48px;
`

const TitleRow = styled.div`
  margin-bottom: 24px;

  display: flex;
  align-items: center;
  gap: 8px;
`

const Title = styled.h1`
  ${headlineLarge};
  margin: 0;
  overflow-wrap: break-word;
`

const ArticleMarkdown = styled(NewsMarkdown)`
  color: var(--theme-on-surface-variant);

  /* Korean separates words with spaces, so long prose should only wrap there rather than splitting
     a word across lines. */
  &:lang(ko) {
    word-break: keep-all;
  }
`

/**
 * Lays out a long-form guide, written as markdown, as its own linkable page. Images in the guide
 * render inline when they're served from our public assets.
 */
export function GuidePage({
  path,
  title,
  markdown,
}: {
  /** The guide's own path, for page view tracking. */
  path: string
  title: string
  markdown: string
}) {
  const { t } = useTranslation()
  useTrackPageView(path)

  return (
    <Root>
      <Article>
        <TitleRow>
          <Title>{title}</Title>
          <CopyLinkButton
            tooltipPosition='right'
            startingText={t('guides.copyLink', 'Copy link to this guide')}
          />
        </TitleRow>
        <ArticleMarkdown source={markdown} allowMedia={true} />
      </Article>
      <BottomLinks />
    </Root>
  )
}

/**
 * Escapes text for use inside a markdown image's alt text or quoted title, so translated strings
 * can't break out of the image syntax.
 */
export function escapeMarkdownImageText(text: string): string {
  return text.replace(/[[\]"\\]/g, '\\$&')
}
