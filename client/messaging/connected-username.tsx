import React from 'react'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/user-info'
import { useUserOverlays } from '../profile/user-overlays'
import { useAppSelector } from '../redux-hooks'
import { colorDividers } from '../styles/colors'

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

/**
 * A component which displays the username in messaging-related services (e.g. chat, lobbies,
 * whispers) and any additional functionality that we might want to do with them, like opening a
 * user profile when clicked.
 *
 * This component is connected to the store where it tries to find the user. All the services using
 * it should ensure that the user is loaded in the store properly.
 */
export function ConnectedUsername({
  className,
  userId,
  isMention = false,
}: {
  className?: string
  userId: SbUserId
  isMention?: boolean
}) {
  const { clickableElemRef, overlayNodes, onClick, onContextMenu } =
    useUserOverlays<HTMLSpanElement>({
      userId,
      profileAnchorX: 'right',
      profileAnchorY: 'top',
      profileOriginX: 'left',
      profileOriginY: 'top',
      profileOffsetX: 4,
    })

  const user = useAppSelector(s => s.users.byId.get(userId))
  const username = user?.name ?? (
    <LoadingName aria-label={'Username loading…'}>
      &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;
    </LoadingName>
  )

  return (
    <>
      {overlayNodes}

      <Username
        ref={clickableElemRef}
        className={className}
        onClick={onClick}
        onContextMenu={onContextMenu}>
        {isMention ? '@' : ''}
        {username}
      </Username>
    </>
  )
}
