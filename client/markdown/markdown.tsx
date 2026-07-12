import { lazy, Suspense } from 'react'
import type { Components } from 'react-markdown'
import styled, { css } from 'styled-components'
import { ExternalLink } from '../navigation/external-link'
import { LoadingDotsArea } from '../progress/dots'
import {
  bodyMedium,
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
    font-weight: 700;
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
  /** Whether markdown images render as actual inline media (images/video) rather than links. */
  allowMedia?: boolean
}

const COMPONENTS: Components = {
  a: ({ href, children }) => <ExternalLink href={href!}>{children}</ExternalLink>,
  img: ({ alt, src }) => <ExternalLink href={src!}>{alt}</ExternalLink>,
}

const VIDEO_EXTENSIONS = ['.mp4', '.webm']

function isVideoUrl(src: string): boolean {
  let url: URL
  try {
    url = new URL(src, window.location.href)
  } catch {
    return false
  }
  const pathname = url.pathname.toLowerCase()
  return VIDEO_EXTENSIONS.some(ext => pathname.endsWith(ext))
}

const mediaStyle = css`
  display: block;
  max-width: 100%;
  max-height: min(640px, 70vh);
  margin: 16px auto 8px;
  border-radius: 4px;
`

const Video = styled.video`
  ${mediaStyle};
`

const Image = styled.img`
  ${mediaStyle};
`

const Caption = styled.span`
  ${bodyMedium};
  display: block;
  margin-bottom: 16px;
  color: var(--theme-on-surface-variant);
  text-align: center;
`

function MarkdownMedia({ src, alt, title }: { src?: string; alt?: string; title?: string }) {
  if (!src) {
    return null
  }

  return (
    <>
      {isVideoUrl(src) ? (
        <Video
          src={src}
          autoPlay={true}
          loop={true}
          muted={true}
          playsInline={true}
          controls={true}
        />
      ) : (
        <Image src={src} alt={alt ?? ''} loading='lazy' draggable={false} />
      )}
      {title ? <Caption>{title}</Caption> : null}
    </>
  )
}

const MEDIA_COMPONENTS: Components = {
  a: ({ href, children }) => <ExternalLink href={href!}>{children}</ExternalLink>,
  img: ({ alt, src, title }) => <MarkdownMedia src={src} alt={alt} title={title} />,
}

export function Markdown({ source, className, allowMedia }: MarkdownProps) {
  return (
    <Suspense fallback={<LoadingDotsArea />}>
      <Root className={className}>
        <LoadableMarkdown skipHtml={true} components={allowMedia ? MEDIA_COMPONENTS : COMPONENTS}>
          {source}
        </LoadableMarkdown>
      </Root>
    </Suspense>
  )
}
