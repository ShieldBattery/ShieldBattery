import React from 'react'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/user-info'
import Avatar from '../avatars/avatar'
import { Popover, PopoverProps } from '../material/popover'
import { useAppSelector } from '../redux-hooks'
import { colorDividers } from '../styles/colors'
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

// TODO(tec27): This should just be handled by the Avatar component
const LoadingAvatar = styled.div`
  width: 64px;
  height: 64px;
  margin-bottom: 16px;

  background-color: ${colorDividers};
  border-radius: 50%;
`

const Username = styled.div`
  ${headline6};
  ${singleLine};
`

const LoadingUsername = styled.div`
  width: 48px;
  height: 20px;
  margin: 4px 0;

  background-color: ${colorDividers};
  border-radius: 2px;
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

  return (
    <Popover {...popoverProps}>
      <PopoverContents>
        <Header>
          {user ? (
            <>
              <StyledAvatar user={user.name} />
              <Username>{user.name}</Username>
            </>
          ) : (
            <>
              <LoadingAvatar />
              <LoadingUsername aria-label='Username loading…' />
            </>
          )}
        </Header>
      </PopoverContents>
    </Popover>
  )
}
