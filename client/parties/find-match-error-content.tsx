import React from 'react'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user'
import { Subtitle1, subtitle2 } from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'

const UserList = styled.ul``

const UserListItem = styled.li``

const StyledConnectedUsername = styled(ConnectedUsername)`
  ${subtitle2};
`

export function AlreadySearchingErrorContent({ users }: { users: SbUserId[] }) {
  return (
    <Subtitle1>
      Some party members are already playing a game, searching for a match, or in a custom lobby:
      <UserList>
        {users.map(u => (
          <UserListItem key={String(u)}>
            <StyledConnectedUsername userId={u} />
          </UserListItem>
        ))}
      </UserList>
    </Subtitle1>
  )
}
