import React from 'react'
import { hot } from 'react-hot-loader/root'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/user-info'
import { ConnectedUsername } from '../profile/connected-username'
import { Subtitle1, subtitle2 } from '../styles/typography'

const UserList = styled.ul``

const UserListItem = styled.li``

const StyledConnectedUsername = styled(ConnectedUsername)`
  ${subtitle2};
`

// NOTE(tec27): The hot() call here is necessary because this file is used by socket-handlers,
// which get included at a level that does not get hot-reloaded. Without this, everything this
// component uses (and anything that also uses it) cannot be hot reloaded, which is a lot of things!
export const AlreadySearchingErrorContent = hot(({ users }: { users: SbUserId[] }) => {
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
})
