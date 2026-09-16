import styled from 'styled-components'
import { Markdown } from '../markdown/markdown'
import { bodyLarge } from '../styles/typography'

/**
 * Markdown rendered at article scale for news posts: a larger body size and wider paragraph
 * spacing than the app default, which is sized for chat and dialogs. Both the published post page
 * and the admin editor preview render through this so the preview matches the post.
 */
export const NewsMarkdown = styled(Markdown)`
  ${bodyLarge};

  p {
    margin-top: 16px;
    margin-bottom: 16px;
  }
`
