import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { buttonReset } from '../material/button-reset'
import { standardEasing } from '../material/curve-constants'
import { YoutubeVideo } from './youtube-url'

/** Markdown media renders inside paragraphs, so everything here must be phrasing content. */
const Root = styled.span`
  position: relative;
  display: block;
  aspect-ratio: 16 / 9;
  overflow: hidden;

  background-color: var(--theme-container-low);
`

const Player = styled.iframe`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: none;
`

const PlayButton = styled.span`
  position: absolute;
  top: 50%;
  left: 50%;
  width: 72px;
  height: 72px;
  display: flex;
  align-items: center;
  justify-content: center;

  background-color: var(--theme-on-surface-variant);
  border-radius: 50%;
  box-shadow: 0 4px 16px rgb(0 0 0 / 0.4);
  color: var(--theme-surface);
  transform: translate(-50%, -50%);
  transition:
    background-color 150ms ${standardEasing},
    color 150ms ${standardEasing},
    transform 150ms ${standardEasing};
`

const Facade = styled.button`
  ${buttonReset};
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  padding: 0;

  /* The outline would be clipped by the root's rounded overflow, so focus draws inside instead. */
  &:focus-visible {
    outline-offset: -3px;
  }

  /* A ::before paints above the (unpositioned) thumbnail but below the play button. */
  &::before {
    position: absolute;
    inset: 0;
    content: '';

    background: radial-gradient(circle at center, rgb(0 0 0 / 0.3), transparent 50%);
    pointer-events: none;
  }

  &:hover > ${PlayButton}, &:focus-visible > ${PlayButton} {
    background-color: var(--theme-primary);
    color: var(--theme-on-primary);
    transform: translate(-50%, -50%) scale(1.08);
  }
`

const Thumbnail = styled.img<{ $loaded: boolean }>`
  width: 100%;
  height: 100%;
  display: block;
  /* The fallback thumbnail size is 4:3 with letterboxing baked in for widescreen videos; covering
     the 16:9 frame crops exactly those bars off. */
  object-fit: cover;

  opacity: ${props => (props.$loaded ? 1 : 0)};
  transition: opacity 150ms ${standardEasing};
`

/**
 * Thumbnail sizes to try, best first. YouTube only has the 1280x720 `maxresdefault` for videos
 * uploaded in HD, while `hqdefault` exists for every video.
 */
const THUMBNAIL_SIZES = ['maxresdefault', 'hqdefault'] as const
/**
 * YouTube answers a request for a missing thumbnail size with a placeholder image of this width
 * (served with a 404, which doesn't stop the browser from loading it as an image).
 */
const MISSING_THUMBNAIL_WIDTH = 120

function embedUrl(video: YoutubeVideo): string {
  // The player only exists once the viewer clicks the facade, so autoplay just lets that click
  // start playback rather than requiring a second click on YouTube's own play button.
  const params = new URLSearchParams({ autoplay: '1', rel: '0' })
  if (video.startSeconds) {
    params.set('start', String(video.startSeconds))
  }
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.id)}?${params}`
}

export interface YoutubeEmbedProps {
  video: YoutubeVideo
  /** A description of the video, used to label the player for assistive technology. */
  description?: string
  className?: string
}

/**
 * An embedded YouTube player that shows the video's thumbnail until clicked, so YouTube's player
 * (and its tracking) only loads for viewers who actually choose to watch.
 */
export function YoutubeEmbed({ video, description, className }: YoutubeEmbedProps) {
  const { t } = useTranslation()
  const [playing, setPlaying] = useState(false)
  const [thumbnailSizeIndex, setThumbnailSizeIndex] = useState(0)
  const [thumbnailLoaded, setThumbnailLoaded] = useState(false)
  const playerRef = useRef<HTMLIFrameElement>(null)

  // The facade button that had focus is gone once the player replaces it, so focus moves into the
  // player to keep keyboard users in place.
  useEffect(() => {
    if (playing) {
      playerRef.current?.focus()
    }
  }, [playing])

  const label = description || t('markdown.youtube.defaultTitle', 'YouTube video')

  const tryNextThumbnailSize = () => {
    if (thumbnailSizeIndex < THUMBNAIL_SIZES.length - 1) {
      setThumbnailSizeIndex(thumbnailSizeIndex + 1)
    }
  }

  return (
    <Root className={className}>
      {playing ? (
        <Player
          ref={playerRef}
          src={embedUrl(video)}
          title={label}
          allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'
          allowFullScreen={true}
          referrerPolicy='strict-origin-when-cross-origin'
        />
      ) : (
        <Facade
          type='button'
          aria-label={t('markdown.youtube.play', { defaultValue: 'Play {{title}}', title: label })}
          onClick={() => setPlaying(true)}>
          <Thumbnail
            src={`https://i.ytimg.com/vi/${encodeURIComponent(video.id)}/${THUMBNAIL_SIZES[thumbnailSizeIndex]}.jpg`}
            alt=''
            loading='lazy'
            draggable={false}
            $loaded={thumbnailLoaded}
            onLoad={event => {
              if (event.currentTarget.naturalWidth <= MISSING_THUMBNAIL_WIDTH) {
                tryNextThumbnailSize()
              } else {
                setThumbnailLoaded(true)
              }
            }}
            onError={tryNextThumbnailSize}
          />
          <PlayButton>
            <MaterialIcon icon='play_arrow' size={44} />
          </PlayButton>
        </Facade>
      )}
    </Root>
  )
}
