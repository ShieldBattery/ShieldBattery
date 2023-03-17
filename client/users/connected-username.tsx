import React, { useEffect } from 'react'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { colorDividers } from '../styles/colors'
import { getBatchUserInfo } from './action-creators'
import { ConnectedUserContextMenu, MenuItemCategory } from './user-context-menu'
import { useUserOverlays } from './user-overlays'
import { ConnectedUserProfileOverlay } from './user-profile-overlay'

const Username = styled.span`
  &:hover {
    cursor: pointer;
    text-decoration: underline;
  }
`

const LoadingName = styled.span`
  margin-right: 0.25em;
  background-color: ${colorDividers};
  border-radius: 2px;
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
  /**
   * An optional function that will be called when rendering menu items. If provided, the value
   * returned from this function will be used as the `children` of the menu. Mutating the input
   * value and returning it is okay.
   */
  modifyMenuItems?: (
    userId: SbUserId,
    items: Map<MenuItemCategory, React.ReactNode[]>,
    onMenuClose: (event?: MouseEvent) => void,
  ) => Map<MenuItemCategory, React.ReactNode[]>
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
  modifyMenuItems,
}: ConnectedUsernameProps) {
  const dispatch = useAppDispatch()
  const user = useAppSelector(s => s.users.byId.get(userId))

  useEffect(() => {
    dispatch(getBatchUserInfo(userId))
  }, [dispatch, userId])

  const { clickableElemRef, profileOverlayProps, contextMenuProps, onClick, onContextMenu } =
    useUserOverlays<HTMLSpanElement>({
      userId,
      profileAnchorX: 'right',
      profileAnchorY: 'top',
      profileOriginX: 'left',
      profileOriginY: 'top',
      profileOffsetX: 4,
      filterClick,
      modifyMenuItems,
    })

  const username = user?.name ?? (
    <LoadingName aria-label={'Username loading…'}>
      &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;
    </LoadingName>
  )

  return (
    <>
      <ConnectedUserProfileOverlay {...profileOverlayProps} />
      <ConnectedUserContextMenu {...contextMenuProps} />

      <Username
        ref={clickableElemRef}
        className={className}
        onClick={onClick}
        onContextMenu={onContextMenu}>
        {prefix}
        {username}
      </Username>
    </>
  )
}
