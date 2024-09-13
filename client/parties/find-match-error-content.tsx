import React from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { styled } from 'styled-components'
import { SbUserId } from '../../common/users/sb-user.js'
import { Subtitle1, subtitle2 } from '../styles/typography.js'
import { ConnectedUsername } from '../users/connected-username.js'

const UserList = styled.ul``

const UserListItem = styled.li``

const StyledConnectedUsername = styled(ConnectedUsername)`
  ${subtitle2};
`

export function AlreadySearchingErrorContent({ users }: { users: SbUserId[] }) {
  const { t } = useTranslation()
  return (
    <Subtitle1>
      <Trans t={t} i18nKey='parties.errors.alreadySearching'>
        Some party members are already playing a game, searching for a match, or in a custom lobby:
      </Trans>
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
