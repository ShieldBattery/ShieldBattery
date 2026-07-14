import { lazy, Suspense } from 'react'
import type { Components, ExtraProps } from 'react-markdown'
import styled, { css } from 'styled-components'
import { ExternalLink } from '../navigation/external-link'
import { makePublicAssetUrl } from '../network/server-url'
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

/**
 * The hast element type react-markdown passes to component renderers as `node` (`Element` from
 * `hast` — that package isn't directly importable here, but react-markdown's types expose it).
 */
export type HastElement = NonNullable<ExtraProps['node']>

/**
 * Recursively collects the `src` of every `img` element in a hast element's subtree. Recursion
 * matters because a linked image can nest the img under other inline elements, e.g.
 * `[*![x](url)*](href)` puts it under an emphasis.
 */
export function collectImgSrcs(element: HastElement): string[] {
  const srcs: string[] = []
  for (const child of element.children ?? []) {
    if (child.type !== 'element') {
      continue
    }
    if (child.tagName === 'img' && typeof child.properties?.src === 'string') {
      srcs.push(child.properties.src)
    }
    srcs.push(...collectImgSrcs(child))
  }
  return srcs
}

const COMPONENTS: Components = {
  a: ({ node, href, children }) => {
    // Markdown images render as links here, so keeping the anchor around a link-wrapped image
    // (`[![alt](img)](href)`) would nest anchors — invalid HTML. Rendering just the children
    // loses no information, since the images themselves already render as links.
    if (node && collectImgSrcs(node).length > 0) {
      return <>{children}</>
    }
    return <ExternalLink href={href!}>{children}</ExternalLink>
  },
  // `alt || src` so an image with empty alt text doesn't become an invisible, unlabeled link.
  img: ({ alt, src }) => <ExternalLink href={src!}>{alt || src}</ExternalLink>,
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

/**
 * Returns whether `src` is an absolute URL whose origin exactly matches `trustedOrigin`.
 *
 * This gates which markdown image/video URLs are allowed to render as actual inline media: without
 * it, a news post's markdown could make every viewer's client fetch from arbitrary third-party
 * hosts just by embedding `![](url)`. Untrusted URLs aren't dropped, they just fall back to
 * rendering as a plain link instead of media.
 */
export function isTrustedMediaUrl(src: string, trustedOrigin: string): boolean {
  try {
    // `new URL` is given no base, so a relative `src` throws here rather than silently resolving
    // against `window.location`. `data:`/`javascript:` URLs parse fine but their `.origin` is the
    // literal string `'null'`, which can never match a real origin.
    return new URL(src).origin === trustedOrigin
  } catch {
    return false
  }
}

/**
 * Returns the origin our public assets/file store is served from (media URLs matching it may
 * render as actual inline media), or `undefined` if it can't be determined (in which case
 * everything is treated as untrusted).
 */
function getTrustedOrigin(): string | undefined {
  try {
    return new URL(makePublicAssetUrl('/')).origin
  } catch {
    return undefined
  }
}

function MarkdownMedia({ src, alt, title }: { src?: string; alt?: string; title?: string }) {
  if (!src) {
    return null
  }

  const trustedOrigin = getTrustedOrigin()
  if (!trustedOrigin || !isTrustedMediaUrl(src, trustedOrigin)) {
    // Not served from our own file store: fall back to the same link rendering used for non-media
    // markdown images, rather than pointing an <img>/<video> tag at an arbitrary third-party host.
    return <ExternalLink href={src}>{alt || src}</ExternalLink>
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
  a: ({ node, href, children }) => {
    // An untrusted image inside a link falls back to rendering as a link itself, so keeping the
    // outer anchor would nest anchors — invalid HTML; render just the children instead. A trusted
    // image wrapped in a link is the legit clickable-image pattern (`<a><img></a>` is valid), so
    // that keeps its anchor.
    const trustedOrigin = getTrustedOrigin()
    const imgSrcs = node ? collectImgSrcs(node) : []
    if (imgSrcs.some(src => !trustedOrigin || !isTrustedMediaUrl(src, trustedOrigin))) {
      return <>{children}</>
    }
    return <ExternalLink href={href!}>{children}</ExternalLink>
  },
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
