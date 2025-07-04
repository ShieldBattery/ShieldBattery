import { lazy, Suspense } from 'react'
import type { Components } from 'react-markdown'
import styled from 'styled-components'
import { ExternalLink } from '../navigation/external-link'
import { LoadingDotsArea } from '../progress/dots'
import {
  headlineLarge,
  headlineMedium,
  headlineSmall,
  titleLarge,
  titleMedium,
  titleSmall,
} from '../styles/typography'

const LoadableMarkdown = lazy(() => import('react-markdown'))

const Root = styled.div`
  &,
  & * {
    user-select: text;
  }

  h1 {
    ${headlineLarge};
    margin-top: 16px;
    margin-bottom: 8px;
  }

  h2 {
    ${headlineMedium};
    margin-top: 16px;
    margin-bottom: 8px;
  }

  h3 {
    ${headlineSmall};
    margin-top: 16px;
    margin-bottom: 8px;
  }

  h4 {
    ${titleLarge};
    margin-top: 16px;
    margin-bottom: 8px;
  }

  h5 {
    ${titleMedium};
    margin-top: 16px;
    margin-bottom: 8px;
  }

  h6 {
    ${titleSmall};
    margin-top: 16px;
    margin-bottom: 8px;
  }

  b,
  strong {
    font-weight: 500;
  }

  p {
    margin-top: 12px;
    margin-bottom: 8px;
  }

  ul,
  ol {
    padding-left: 28px;
  }

  li + li,
  li > ul,
  li > ol {
    margin-top: 8px;
  }

  blockquote {
    margin-left: 0;
    margin-right: 16px;
    padding: 4px 4px 4px 16px;

    background-color: var(--theme-container-low);
    border-left: 8px solid var(--theme-outline-variant);
  }

  hr {
    border: none;
    box-sizing: border-box;
    height: 1px;
    margin: 7px 0 8px 0;

    background-color: var(--theme-outline-variant);
  }

  & > *:first-child {
    margin-top: 0;
  }
`

export interface MarkdownProps {
  source: string
  className?: string
}

const COMPONENTS: Components = {
  a: ({ href, children }) => <ExternalLink href={href!}>{children}</ExternalLink>,
  img: ({ alt, src }) => <ExternalLink href={src!}>{alt}</ExternalLink>,
}

export function Markdown({ source, className }: MarkdownProps) {
  return (
    <Suspense fallback={<LoadingDotsArea />}>
      <Root className={className}>
        <LoadableMarkdown skipHtml={true} components={COMPONENTS}>
          {source}
        </LoadableMarkdown>
      </Root>
    </Suspense>
  )
}
