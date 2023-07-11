import React, { Suspense } from 'react'
import type { Components } from 'react-markdown'
import styled from 'styled-components'
import { ExternalLink } from '../navigation/external-link'
import { LoadingDotsArea } from '../progress/dots'
import { colorDividers } from '../styles/colors'
import { headline5, headline6, subtitle1, subtitle2 } from '../styles/typography'

const LoadableMarkdown = React.lazy(() => import('react-markdown'))

const StyledMarkdown = styled(LoadableMarkdown)`
  &,
  & * {
    user-select: text;
  }

  h1 {
    ${headline5};
    font-weight: 500;
    margin-top: 16px;
    margin-bottom: 8px;
  }

  h2 {
    ${headline5};
    margin-top: 16px;
    margin-bottom: 8px;
  }

  h3 {
    ${headline6};
    margin-top: 16px;
    margin-bottom: 8px;
  }

  h4 {
    ${subtitle1};
    font-weight: 500;
    margin-top: 16px;
    margin-bottom: 8px;
  }

  h5 {
    ${subtitle2};
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

  blockquote {
    margin-left: 0;
    margin-right: 16px;
    padding: 4px 4px 4px 16px;

    background-color: rgba(255, 255, 255, 0.08);
    border-left: 8px solid ${colorDividers};
  }

  hr {
    border: none;
    box-sizing: border-box;
    height: 1px;
    margin: 7px 0 8px 0;

    background-color: ${colorDividers};
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
      <StyledMarkdown className={className} skipHtml={true} components={COMPONENTS}>
        {source}
      </StyledMarkdown>
    </Suspense>
  )
}
