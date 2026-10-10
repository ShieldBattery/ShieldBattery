import styled from 'styled-components'
import { Markdown } from '../markdown/markdown'
import { Dialog } from '../material/dialog'
import { bodyLarge, titleMedium } from '../styles/typography'

const ArticleMarkdown = styled(Markdown)`
  ${bodyLarge};
  color: var(--theme-on-surface-variant);

  h2 {
    ${titleMedium};
    color: var(--theme-on-surface);
  }

  p {
    margin-top: 16px;
    margin-bottom: 16px;
  }
`

/**
 * Shows a long-form explainer article, written as markdown, in a dialog. Images in the article
 * render inline when they're served from our public assets.
 */
export function ExplainerDialog({
  title,
  markdown,
  onCancel,
}: {
  title: string
  markdown: string
  onCancel: () => void
}) {
  return (
    <Dialog title={title} onCancel={onCancel} showCloseButton={true}>
      <ArticleMarkdown source={markdown} allowMedia={true} />
    </Dialog>
  )
}

/**
 * Escapes text for use inside a markdown image's alt text or quoted title, so translated strings
 * can't break out of the image syntax.
 */
export function escapeMarkdownImageText(text: string): string {
  return text.replace(/[[\]"\\]/g, '\\$&')
}
