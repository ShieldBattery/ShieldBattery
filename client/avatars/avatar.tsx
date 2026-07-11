import { useContext, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { SbUserId } from '../../common/users/sb-user-id'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { LiveUsersContext } from '../twitch/live-state'
import { getBatchUserInfo } from '../users/action-creators'
import PlaceholderIcon from './avatar-placeholder.svg'
import { randomColorForString } from './colors'

/**
 * A ring drawn around an avatar to indicate the user is currently live-streaming. Uses `outline`
 * (which follows the avatar's border-radius and whose offset gap shows the real surface behind it)
 * so the ring reads consistently on any background without needing to know the surface color.
 */
const liveRing = css`
  outline: 2px solid var(--theme-live);
  outline-offset: 2px;
`

export const ImageAvatar = styled.img<{ $glowing?: boolean; $live?: boolean }>`
  width: 40px;
  height: 40px;
  display: inline-block;
  border-radius: 50%;
  ${props => (props.$glowing ? `box-shadow: 0 0 8px var(--theme-amber)` : '')};
  ${props => (props.$live ? liveRing : '')};
`

export const IconContainer = styled.div<{ $live?: boolean }>`
  position: relative;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  ${props =>
    props.$live
      ? css`
          border-radius: 50%;
          ${liveRing};
        `
      : ''};
`

export const IconAvatar = styled(PlaceholderIcon)<{ $glowing?: boolean; $color?: string }>`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  fill: ${props => props.$color};
  ${props => (props.$glowing ? 'filter: blur(4px)' : '')};
`

export interface AvatarProps {
  user?: string
  image?: string
  color?: string
  glowing?: boolean
  className?: string
  /** Whether to draw a "live" ring around the avatar (currently: the user is streaming on Twitch). */
  live?: boolean
  /** Native tooltip text shown while `live`, explaining what the ring means. */
  liveTitle?: string
}

export function Avatar({ image, user, color, glowing, className, live, liveTitle }: AvatarProps) {
  if (image) {
    return (
      <ImageAvatar
        className={className}
        src={image}
        $glowing={glowing}
        $live={live}
        title={live ? liveTitle : undefined}
      />
    )
  }

  let avatarColor
  if (color) {
    avatarColor = color
  } else if (user) {
    avatarColor = randomColorForString(user)
  } else {
    avatarColor = 'var(--theme-on-surface-variant)'
  }

  return (
    <IconContainer className={className} $live={live} title={live ? liveTitle : undefined}>
      {glowing ? <IconAvatar $color={avatarColor} $glowing={true} /> : null}
      <IconAvatar $color={avatarColor} />
    </IconContainer>
  )
}

const LoadingAvatar = styled.div`
  width: 40px;
  height: auto;
  aspect-ratio: 1 / 1;

  background-color: var(--theme-skeleton);
  border-radius: 100%;
`

export interface ConnectedAvatarProps {
  userId: SbUserId
  className?: string
  /**
   * Whether to show the live-streaming ring when this user is live. Defaults to true. Set to false
   * in surfaces that render their own live treatment for the avatar (e.g. the profile header and
   * hover card, which draw their own ring + badge).
   */
  showLiveIndicator?: boolean
}

export function ConnectedAvatar({
  userId,
  className,
  showLiveIndicator = true,
}: ConnectedAvatarProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const username = useAppSelector(s => s.users.byId.get(userId)?.name)
  const avatarUrl = useAppSelector(s => s.users.byId.get(userId)?.avatarUrl)
  const liveUsers = useContext(LiveUsersContext)
  const isLive = showLiveIndicator && liveUsers.has(userId)

  useEffect(() => {
    dispatch(getBatchUserInfo(userId))
  }, [dispatch, userId])

  if (!username) {
    return <LoadingAvatar className={className} />
  } else {
    return (
      <Avatar
        user={username}
        image={avatarUrl}
        className={className}
        live={isLive}
        liveTitle={t('twitch.live.avatarTooltip', 'Live on Twitch')}
      />
    )
  }
}
