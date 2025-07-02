import { useEffect } from 'react'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user-id'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { getBatchUserInfo } from '../users/action-creators'
import PlaceholderIcon from './avatar-placeholder.svg'
import { randomColorForString } from './colors'

export const ImageAvatar = styled.img<{ $glowing?: boolean }>`
  width: 40px;
  height: 40px;
  display: inline-block;
  border-radius: 50%;
  ${props => (props.$glowing ? `box-shadow: 0 0 8px var(--theme-amber)` : '')};
`

export const IconContainer = styled.div`
  position: relative;
  width: 40px;
  height: 40px;
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
}

export function Avatar({ image, user, color, glowing, className }: AvatarProps) {
  if (image) {
    return <ImageAvatar className={className} src={image} $glowing={glowing} />
  }

  let avatarColor
  if (color) {
    avatarColor = color
  } else if (user) {
    avatarColor = randomColorForString(user)
  } else {
    avatarColor = 'rgba(255, 255, 255, 0.5)'
  }

  return (
    <IconContainer className={className}>
      {glowing ? <IconAvatar $color={avatarColor} $glowing={true} /> : null}
      <IconAvatar $color={avatarColor} />
    </IconContainer>
  )
}

const LoadingAvatar = styled.div`
  width: 100%;
  height: auto;
  aspect-ratio: 1 / 1;

  background-color: var(--theme-skeleton);
  border-radius: 100%;
`

export interface ConnectedAvatarProps {
  userId: SbUserId
  className?: string
}

export function ConnectedAvatar({ userId, className }: ConnectedAvatarProps) {
  const dispatch = useAppDispatch()
  const username = useAppSelector(s => s.users.byId.get(userId)?.name)

  useEffect(() => {
    dispatch(getBatchUserInfo(userId))
  }, [dispatch, userId])

  if (!username) {
    return <LoadingAvatar className={className} />
  } else {
    return <Avatar user={username} className={className} />
  }
}
