import { Immutable } from 'immer'
import React, { useCallback } from 'react'
import styled from 'styled-components'
import { Link, useRoute } from 'wouter'
import { urlPath } from '../../common/urls'
import CloseIcon from '../icons/material/close-24px.svg'
import InviteIcon from '../icons/material/group_add-24px.svg'
import PartyIcon from '../icons/material/supervised_user_circle-24px.svg'
import { IconButton } from '../material/button'
import AttentionIndicator from '../material/left-nav/attention-indicator'
import { amberA200, colorTextFaint } from '../styles/colors'
import { singleLine, subtitle2 } from '../styles/typography'
import { CurrentPartyState } from './party-reducer'
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation()
  return (
    <Container isActive={isActive}>
      {needsAttention ? <AttentionIndicator /> : null}
      <StyledLink to={link}>
        <StyledPartyIcon />
        <Title isActive={isActive}>{t('parties.partyNavEntry.partyLabel', 'Party')}</Title>
        {canInvite ? (
          <EntryButton icon={<InviteIcon />} title={t('parties.partyNavEntry.invitePlayersLabel', 'Invite players')} onClick={onInviteClick} />
        ) : null}
        <EntryButton icon={<CloseIcon />} title={t('parties.partyNavEntry.leavePartyLabel', 'Leave party')} onClick={onLeaveClick} />
      </StyledLink>
    </Container>
  )
}
