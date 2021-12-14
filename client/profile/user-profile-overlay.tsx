import React from 'react'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/user-info'
import Avatar from '../avatars/avatar'
import { Popover, PopoverProps } from '../material/popover'
import { useAppSelector } from '../redux-hooks'
import { headline6, singleLine } from '../styles/typography'

const PopoverContents = styled.div`
  min-width: 240px;
`

const Header = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 24px;
`

const StyledAvatar = styled(Avatar)`
  width: 64px;
  height: 64px;
  margin-bottom: 16px;
`

const Username = styled.div`
  ${headline6};
  ${singleLine};
`

export interface ConnectedUserProfileOverlayProps {
  userId: SbUserId
  popoverProps: Omit<PopoverProps, 'children'>
}

export function ConnectedUserProfileOverlay({
  userId,
  popoverProps,
}: ConnectedUserProfileOverlayProps) {
  const user = useAppSelector(s => s.users.byId.get(userId))

  if (!user) {
    return null
  }

  return (
    <Popover {...popoverProps}>
      <PopoverContents>
        <Header>
          <StyledAvatar user={user.name} />
          <Username>{user.name}</Username>
        </Header>
      </PopoverContents>
    </Popover>
  )
}
