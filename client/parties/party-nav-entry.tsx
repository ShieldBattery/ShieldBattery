import React, { useCallback } from 'react'
import styled from 'styled-components'
import { Link, useRoute } from 'wouter'
import InviteIcon from '../icons/material/group_add_black_24px.svg'
import CloseIcon from '../icons/material/ic_close_black_24px.svg'
import PartyIcon from '../icons/material/supervised_user_circle_black_24px.svg'
import { IconButton } from '../material/button'
import { urlPath } from '../network/urls'
import { amberA200, colorTextFaint } from '../styles/colors'
import { singleLine, subtitle2 } from '../styles/typography'
import { PartyRecord } from './party-reducer'

const Container = styled.li<{ isActive: boolean }>`
  height: 48px;
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
  padding: 0 16px;

  &:link,
  &:visited,
  &:hover,
  &:active {
    color: currentColor;
    text-decoration: none;
  }
`

const StyledPartyIcon = styled(PartyIcon)`
  width: 36px;
  height: 36px;
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
    margin-left: 8px;
  }
`

export interface PartyNavEntryProps {
  party: PartyRecord
  currentPath: string
  onInviteUserClick: () => void
  onLeavePartyClick: (partyId: string) => void
}

export function PartyNavEntry({
  party,
  currentPath,
  onInviteUserClick,
  onLeavePartyClick,
}: PartyNavEntryProps) {
  const partyId = party.id
  const link = urlPath`/parties/${partyId}`
  const [isActive] = useRoute('/parties/:partyId/:rest*')

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
      <StyledLink to={link}>
        <StyledPartyIcon />
        <Title isActive={isActive}>Party</Title>
        <EntryButton icon={<InviteIcon />} title='Invite players' onClick={onInviteClick} />
        <EntryButton icon={<CloseIcon />} title='Leave party' onClick={onLeaveClick} />
      </StyledLink>
    </Container>
  )
}
