import * as React from 'react'
import { useEffect } from 'react'
import styled, { css } from 'styled-components'
import { SbUserId } from '../../common/users/sb-user-id'
import { useOverflowingElement } from '../dom/overflowing-element'
import { Tooltip, TooltipPosition } from '../material/tooltip'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { getBatchUserInfo } from './action-creators'
import { ConnectedUserContextMenu, UserMenuComponent } from './user-context-menu'
import { useUserOverlays } from './user-overlays'
import { ConnectedUserProfileOverlay } from './user-profile-overlay'

const Username = styled.span<{ $interactive: boolean }>`
  ${props =>
    props.$interactive
      ? css`
          &:hover {
            cursor: pointer;
            text-decoration: underline;
          }

          &:focus-visible {
            outline: none;
            text-decoration: underline;
          }
        `
      : css``}
`

const LoadingName = styled.span`
  margin-right: 0.25em;
  background-color: var(--theme-skeleton);
  border-radius: 4px;
`

export interface ConnectedUsernameProps {
  className?: string
  /** The user to show the corresponding name for. */
  userId: SbUserId
  /** A string to show before the username, e.g. '@' for mentions. */
  prefix?: string
  /**
   * An optional callback that will be called before the normal `onClick` handling. If the click
   * was handled by the callback, it should return `true` to indicate the normal behavior should
   * not occur.
   */
  filterClick?: (userId: SbUserId, e: React.MouseEvent) => boolean
  UserMenu?: UserMenuComponent
  /** Whether the username can be interacted with (clicked, focused, etc.). Defaults to true. */
  interactive?: boolean
  /** If set, shows a Tooltip containing the players name if the name is ellipsized. */
  showTooltipForOverflow?: TooltipPosition
}

/**
 * A component which displays a clickable username, displaying the user's profile overlay or
 * context menu when clicked.
 */
export function ConnectedUsername({
  className,
  userId,
  prefix = '',
  filterClick,
  UserMenu,
  interactive = true,
  // TODO(tec27): We could probably make this true? Just not sure what layouts it might break
  showTooltipForOverflow,
}: ConnectedUsernameProps) {
  const dispatch = useAppDispatch()
  const user = useAppSelector(s => s.users.byId.get(userId))
  const [nameRef, isNameOverflowing] = useOverflowingElement()

  useEffect(() => {
    dispatch(getBatchUserInfo(userId))
  }, [dispatch, userId])

  const { profileOverlayProps, contextMenuProps, onClick, onContextMenu } = useUserOverlays({
    userId,
    profileAnchorX: 'right',
    profileAnchorY: 'top',
    profileOriginX: 'left',
    profileOriginY: 'top',
    profileOffsetX: 4,
    filterClick,
    UserMenu,
  })

  const username = user?.name ?? (
    <LoadingName aria-label={'Username loading…'}>
      &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;
    </LoadingName>
  )

  const nameElem = (
    <Username
      ref={showTooltipForOverflow ? nameRef : undefined}
      $interactive={interactive}
      className={className}
      onClick={interactive ? onClick : undefined}
      onContextMenu={interactive ? onContextMenu : undefined}
      tabIndex={interactive ? 0 : undefined}>
      {prefix}
      {username}
    </Username>
  )

  return (
    <>
      {interactive && <ConnectedUserProfileOverlay {...profileOverlayProps} />}
      {interactive && <ConnectedUserContextMenu {...contextMenuProps} />}
      {showTooltipForOverflow ? (
        <Tooltip
          text={user?.name}
          position={showTooltipForOverflow}
          disabled={!user || !isNameOverflowing}>
          {nameElem}
        </Tooltip>
      ) : (
        nameElem
      )}
    </>
  )
}
