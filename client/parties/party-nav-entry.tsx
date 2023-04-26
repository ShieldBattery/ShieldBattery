import { Immutable } from 'immer'
import React, { useCallback } from 'react'
import styled from 'styled-components'
import { Link, useRoute } from 'wouter'
import { urlPath } from '../../common/urls'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconButton } from '../material/button'
import AttentionIndicator from '../material/left-nav/attention-indicator'
import { amberA200, colorTextFaint } from '../styles/colors'
import { singleLine, subtitle2 } from '../styles/typography'
import { CurrentPartyState } from './party-reducer'

const Container = styled.li<{ isActive: boolean }>`
  position: relative;
  height: 56px;
  border-radius: 2px;
  background-color: ${props => (props.isActive ? 'rgba(255, 255, 255, 0.08)' : 'transparent')};

  &:hover {
    background-color: ${props =>
      props.isActive ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.04)'};
    cursor: pointer;
  }
`

const StyledLink = styled(Link)`
  display: flex;
  flex-direction: row;
  align-items: center;
  height: 100%;
  padding: 0 4px 0 16px;

  &:link,
  &:visited,
  &:hover,
  &:active {
    color: currentColor;
    text-decoration: none;
  }
`

const StyledPartyIcon = styled(MaterialIcon).attrs({ icon: 'supervised_user_circle', size: 36 })`
  flex-shrink: 0;
  margin-right: 8px;

  color: ${amberA200};
`

const Title = styled.span<{ isActive: boolean }>`
  ${subtitle2};
  ${singleLine};

  flex-grow: 1;
  color: ${props => (props.isActive ? amberA200 : 'currentColor')};
`

const EntryButton = styled(IconButton)`
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  min-height: 36px;
  opacity: 0;
  color: ${colorTextFaint};

  ${Container}:hover & {
    opacity: 1;
  }

  &:hover {
    color: ${amberA200};
  }

  &:not(:first-child) {
    margin-left: 4px;
  }
`

export interface PartyNavEntryProps {
  party: Immutable<CurrentPartyState>
  canInvite: boolean
  onInviteUserClick: () => void
  onLeavePartyClick: (partyId: string) => void
}

export function PartyNavEntry({
  party,
  canInvite,
  onInviteUserClick,
  onLeavePartyClick,
}: PartyNavEntryProps) {
  const partyId = party.id
  const link = urlPath`/parties/${partyId}`
  const [isActive] = useRoute('/parties/:partyId/:rest*')
  const needsAttention = party.hasUnread

  const onInviteClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      onInviteUserClick()
    },
    [onInviteUserClick],
  )

  const onLeaveClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      onLeavePartyClick(partyId)
    },
    [partyId, onLeavePartyClick],
  )

  return (
    <Container isActive={isActive}>
      {needsAttention ? <AttentionIndicator /> : null}
      <StyledLink to={link}>
        <StyledPartyIcon />
        <Title isActive={isActive}>Party</Title>
        {canInvite ? (
          <EntryButton
            icon={<MaterialIcon icon='group_add' />}
            title='Invite players'
            onClick={onInviteClick}
          />
        ) : null}
        <EntryButton
          icon={<MaterialIcon icon='close' />}
          title='Leave party'
          onClick={onLeaveClick}
        />
      </StyledLink>
    </Container>
  )
}
