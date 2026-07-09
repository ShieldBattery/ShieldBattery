import { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import styled, { css, keyframes } from 'styled-components'
import TwitchIcon from '../icons/brands/twitch.svg'
import { MaterialIcon } from '../icons/material/material-icon'
import { useNow } from '../react/date-hooks'
import { bodyMedium, bodySmall, labelMedium, labelSmall, singleLine } from '../styles/typography'

/**
 * A shared visual language for "live" state, reused across the home feed, profiles, and anywhere
 * else a streaming user surfaces. "Live" itself is intentionally brand-neutral (the `--theme-live`
 * color); the only per-platform element is the small platform mark (see `TwitchMark`).
 */

/** The Twitch brand color, used only for the Twitch glyph (a brand mark), never for "live" state. */
export const TWITCH_PURPLE = '#9146ff'

/** A dark scrim used behind pills that overlay stream thumbnails, to keep them legible. */
const THUMBNAIL_OVERLAY = 'rgba(16, 21, 30, 0.82)'

const pulseKeyframes = keyframes`
  0% {
    box-shadow: 0 0 0 0 rgba(224, 29, 60, 0.5);
  }
  70% {
    box-shadow: 0 0 0 6px rgba(224, 29, 60, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(224, 29, 60, 0);
  }
`

/**
 * A filled dot in the "live" color. Pulses gently by default (disabled under reduced-motion). Used
 * on its own next to names, and inside the pills below.
 */
export const LiveDot = styled.span<{ $size?: number; $pulse?: boolean; $color?: string }>`
  width: ${props => props.$size ?? 8}px;
  height: ${props => props.$size ?? 8}px;
  flex-shrink: 0;

  border-radius: 50%;
  background-color: ${props => props.$color ?? 'var(--theme-live)'};

  ${props =>
    (props.$pulse ?? true)
      ? css`
          animation: ${pulseKeyframes} 2.2s ease-out infinite;

          @media (prefers-reduced-motion: reduce) {
            animation: none;
          }
        `
      : ''}
`

const LivePillRoot = styled.div`
  ${labelSmall};
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 20px;
  padding: 0 8px 0 7px;

  border-radius: 5px;
  background-color: var(--theme-live);
  color: #fff;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  white-space: nowrap;
`

/**
 * A small "live" dot for the corner of an avatar in dense lists. Place it inside a
 * `position: relative` avatar container. `$ringColor` should match the surface behind the avatar so
 * the dot reads as separated from it.
 */
export const LiveCornerDot = styled.span<{ $ringColor?: string; $size?: number }>`
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: ${props => props.$size ?? 11}px;
  height: ${props => props.$size ?? 11}px;

  border-radius: 50%;
  background-color: var(--theme-live);
  border: 2px solid ${props => props.$ringColor ?? 'var(--theme-container-low)'};
`

const LiveLabelRoot = styled.div`
  ${labelMedium};
  display: inline-flex;
  align-items: center;
  gap: 6px;

  color: var(--theme-live);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  white-space: nowrap;
`

/** An inline "• Live" label (pulsing dot + text, no fill) for placement next to a name in a list. */
export function LiveLabel({ className }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <LiveLabelRoot className={className}>
      <LiveDot $size={7} />
      {t('twitch.live.badge', 'Live')}
    </LiveLabelRoot>
  )
}

/** A "Live" badge for headers, banners, and thumbnail corners. */
export function LivePill({ className }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <LivePillRoot className={className}>
      <LiveDot $size={6} $pulse={false} $color='#fff' />
      {t('twitch.live.badge', 'Live')}
    </LivePillRoot>
  )
}

const OverlayPill = styled.div`
  ${labelSmall};
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 20px;
  padding: 0 8px;

  border-radius: 5px;
  background-color: ${THUMBNAIL_OVERLAY};
  color: #fff;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`

const compactNumber = new Intl.NumberFormat(navigator.language, {
  notation: 'compact',
  maximumFractionDigits: 1,
})

/** A viewer-count pill (e.g. "1.2K"), designed to overlay a stream thumbnail. */
export function ViewerCountPill({ count, className }: { count: number; className?: string }) {
  return (
    <OverlayPill className={className}>
      <LiveDot $size={6} $pulse={false} />
      {compactNumber.format(count)}
    </OverlayPill>
  )
}

const UptimePillRoot = styled(OverlayPill)`
  color: var(--color-grey90);
`

function formatUptime(startedAt: string | number | Date, now: number, t: TFunction): string {
  const elapsedMs = Math.max(0, now - new Date(startedAt).getTime())
  const totalMinutes = Math.floor(elapsedMs / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0
    ? t('twitch.live.uptimeHoursMinutes', '{{hours}}h {{minutes}}m', { hours, minutes })
    : t('twitch.live.uptimeMinutes', '{{minutes}}m', { minutes })
}

/** How long a stream has been live, formatted (e.g. "1h 34m"), re-computed each minute. */
export function useStreamUptime(startedAt: string | number | Date): string {
  const { t } = useTranslation()
  const now = useNow(60_000)
  return formatUptime(startedAt, now, t)
}

/** How long the stream has been live (e.g. "1h 34m"), overlaying a thumbnail. Ticks each minute. */
export function UptimePill({
  startedAt,
  className,
}: {
  startedAt: string | number | Date
  className?: string
}) {
  const uptime = useStreamUptime(startedAt)
  return <UptimePillRoot className={className}>{uptime}</UptimePillRoot>
}

const PlatformMarkRoot = styled.div<{ $size?: number }>`
  display: inline-grid;
  place-items: center;
  width: ${props => props.$size ?? 18}px;
  height: ${props => props.$size ?? 18}px;
  flex-shrink: 0;

  border-radius: 4px;
  background-color: ${THUMBNAIL_OVERLAY};
`

const TwitchGlyph = styled(TwitchIcon)`
  width: 62%;
  height: 62%;
  color: ${TWITCH_PURPLE};
`

/** The small brand mark shown on a stream, currently Twitch-only. */
export function TwitchMark({ size, className }: { size?: number; className?: string }) {
  return (
    <PlatformMarkRoot $size={size} className={className}>
      <TwitchGlyph />
    </PlatformMarkRoot>
  )
}

const WatchRowRoot = styled.a`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;

  border: 1px solid rgba(224, 29, 60, 0.35);
  border-radius: 6px;
  background:
    linear-gradient(100deg, var(--theme-live-container), transparent 80%),
    var(--theme-container-high);
  color: inherit;
  text-decoration: none;

  &:link,
  &:visited {
    color: inherit;
  }

  &:hover,
  &:focus-visible {
    border-color: var(--theme-live);
    outline: none;
  }
`

const WatchRowIcon = styled(MaterialIcon)`
  flex-shrink: 0;
  color: var(--theme-live);
`

const WatchRowInfo = styled.div`
  min-width: 0;
  flex: 1;
`

const WatchRowTitle = styled.div`
  ${bodyMedium};
  ${singleLine};
`

const WatchRowMeta = styled.div`
  ${bodySmall};
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 1px;

  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

/**
 * A compact "watch this stream" affordance: the stream title + viewer count on a live-tinted row
 * that links out to the broadcast. Used wherever an avatar/name is shown and there's room for a
 * call-to-action (e.g. the profile hover card).
 */
export function LiveWatchRow({
  twitchLogin,
  title,
  viewerCount,
  className,
}: {
  twitchLogin: string
  title: string
  viewerCount: number
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <WatchRowRoot
      href={`https://twitch.tv/${twitchLogin}`}
      target='_blank'
      rel='noopener'
      className={className}>
      <WatchRowIcon icon='play_arrow' size={20} />
      <WatchRowInfo>
        <WatchRowTitle>{title}</WatchRowTitle>
        <WatchRowMeta>
          <LiveDot $size={6} />
          {t('twitch.liveStreams.viewers', '{{count}} watching', { count: viewerCount })}
        </WatchRowMeta>
      </WatchRowInfo>
    </WatchRowRoot>
  )
}
