import { Immutable } from 'immer'
import React, { useCallback, useEffect } from 'react'
import styled from 'styled-components'
import { MAX_PARTY_SIZE } from '../../common/parties'
import { range } from '../../common/range'
import { urlPath } from '../../common/urls'
import { SbUserId } from '../../common/users/sb-user'
import { SelfUserRecord } from '../auth/auth-records'
import { Avatar } from '../avatars/avatar'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import CloseIcon from '../icons/material/close-24px.svg'
import InviteIcon from '../icons/material/group_add-24px.svg'
import SearchOffIcon from '../icons/material/search_off-24px.svg'
import { Slot, SlotEmptyAvatar, SlotEmptyName, SlotName, SlotProfile } from '../lobbies/slot'
import { SlotActions } from '../lobbies/slot-actions'
import { TextButton } from '../material/button'
import { Chat } from '../messaging/chat'
import { SbMessage } from '../messaging/message-records'
import { replace } from '../navigation/routing'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { openSnackbar } from '../snackbars/action-creators'
import { background700, background800 } from '../styles/colors'
import {
  activateParty,
  cancelFindMatchAsParty,
  changeLeader,
  deactivateParty,
  kickPlayer,
  leaveParty,
  sendChatMessage,
} from './action-creators'
import {
  InviteToPartyMessage,
  JoinPartyMessage,
  KickFromPartyMessage,
  LeavePartyMessage,
  PartyLeaderChangeMessage,
  PartyQueueCancelMessage,
  PartyQueueReadyMessage,
  PartyQueueStartMessage,
  SelfJoinPartyMessage,
} from './party-message-layout'
import { PartyMessageType } from './party-message-records'
import { CurrentPartyState } from './party-reducer'

const UserListContainer = styled.div`
  width: 100%;
  flex-grow: 0;
  flex-shrink: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px 16px;
  margin-bottom: 16px;

  background-color: ${background700};
`

const StyledAvatar = styled(Avatar)`
  flex-grow: 0;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  margin-right: 16px;
`

export function OpenSlot() {
  return (
    <Slot>
      <SlotProfile>
        <SlotEmptyAvatar />
        <SlotEmptyName as='span'>Empty</SlotEmptyName>
      </SlotProfile>
    </Slot>
  )
}

export function PlayerSlot({
  name,
  hasLeaderActions,
  onKickPlayer,
  onChangeLeader,
}: {
  name: string
  hasLeaderActions: boolean
  onKickPlayer: () => void
  onChangeLeader: () => void
}) {
  const slotActions: Array<[text: string, handler: () => void]> = []
  if (hasLeaderActions) {
    slotActions.push(['Make leader', onChangeLeader])
    slotActions.push(['Kick from party', onKickPlayer])
  }

  return (
    <Slot>
      <SlotProfile>
        <StyledAvatar user={name} />
        <SlotName as='span'>{name}</SlotName>
      </SlotProfile>
      {slotActions.length > 0 ? <SlotActions slotActions={slotActions} /> : <div />}
    </Slot>
  )
}

function PartySlot({
  userId,
  hasLeaderActions,
  onKickPlayer,
  onChangeLeader,
}: {
  userId: SbUserId
  hasLeaderActions: boolean
  onKickPlayer: (userId: SbUserId) => void
  onChangeLeader: (userId: SbUserId) => void
}) {
  const user = useAppSelector(state => state.users.byId.get(userId))
  const name = user ? user.name : ''

  return (
    <PlayerSlot
      name={name}
      hasLeaderActions={hasLeaderActions}
      onKickPlayer={() => onKickPlayer(userId)}
      onChangeLeader={() => onChangeLeader(userId)}
    />
  )
}

export function UserList({
  party,
  selfUser,
  onKickPlayer,
  onChangeLeader,
}: {
  party: Immutable<CurrentPartyState>
  selfUser: SelfUserRecord
  onKickPlayer: (userId: SbUserId) => void
  onChangeLeader: (userId: SbUserId) => void
}) {
  const filledSlots =
    party?.members.map(u => (
      <PartySlot
        key={u}
        userId={u}
        hasLeaderActions={selfUser.id === party.leader && selfUser.id !== u}
        onKickPlayer={onKickPlayer}
        onChangeLeader={onChangeLeader}
      />
    )) ?? []
  const emptySlots = Array.from(range(filledSlots.length, MAX_PARTY_SIZE), i => (
    <OpenSlot key={'empty-' + i} />
  ))

  return (
    <UserListContainer>
      {filledSlots}
      {emptySlots}
    </UserListContainer>
  )
}

const Container = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  align-items: flex-start;
`

const StyledChat = styled(Chat)`
  max-width: 960px;
  margin-right: 16px;
  flex-grow: 1;

  background-color: ${background800};
`

const RightSide = styled.div`
  width: 256px;
  flex-shrink: 0;
  margin-top: 8px;
  margin-right: 16px;

  display: flex;
  flex-direction: column;
  align-items: center;
`

const StyledInviteIcon = styled(InviteIcon)`
  margin-right: 4px /* account for lack of internal padding, so it lines up with others */;
`

const CancelQueueButton = styled(TextButton)`
  margin-bottom: 24px;
`

function renderPartyMessage(msg: SbMessage) {
  switch (msg.type) {
    case PartyMessageType.SelfJoinParty:
      return <SelfJoinPartyMessage key={msg.id} time={msg.time} leaderId={msg.leaderId} />
    case PartyMessageType.InviteToParty:
      return <InviteToPartyMessage key={msg.id} time={msg.time} userId={msg.userId} />
    case PartyMessageType.JoinParty:
      return <JoinPartyMessage key={msg.id} time={msg.time} userId={msg.userId} />
    case PartyMessageType.LeaveParty:
      return <LeavePartyMessage key={msg.id} time={msg.time} userId={msg.userId} />
    case PartyMessageType.LeaderChange:
      return <PartyLeaderChangeMessage key={msg.id} time={msg.time} userId={msg.userId} />
    case PartyMessageType.KickFromParty:
      return <KickFromPartyMessage key={msg.id} time={msg.time} userId={msg.userId} />
    case PartyMessageType.QueueStart:
      return (
        <PartyQueueStartMessage
          key={msg.id}
          time={msg.time}
          leaderId={msg.leaderId}
          matchmakingType={msg.matchmakingType}
        />
      )
    case PartyMessageType.QueueCancel:
      return <PartyQueueCancelMessage key={msg.id} time={msg.time} reason={msg.reason} />
    case PartyMessageType.QueueReady:
      return <PartyQueueReadyMessage key={msg.id} time={msg.time} />
    default:
      return null
  }
}

interface PartyViewProps {
  params: { partyId: string }
}

export function PartyView(props: PartyViewProps) {
  const dispatch = useAppDispatch()
  const selfUser = useAppSelector(s => s.auth.user)
  const party = useAppSelector(s => s.party.current)
  const partyId = party?.id
  const routePartyId = decodeURIComponent(props.params.partyId)
  const queueId = useAppSelector(s => s.party.current?.queueState?.id)

  const onSendChatMessage = useCallback(
    (msg: string) => dispatch(sendChatMessage(partyId!, msg)),
    [partyId, dispatch],
  )

  const onCancelQueueClick = useCallback(() => {
    if (partyId && queueId) {
      dispatch(
        cancelFindMatchAsParty(partyId, queueId, {
          onSuccess: () => {},
          onError: err => {
            // TODO(tec27): Handle codes
            const message = (err as any).body?.message ?? 'unknown error occurred'
            dispatch(openSnackbar({ message: `Error canceling matchmaking: ${message}` }))
          },
        }),
      )
    }
  }, [partyId, queueId, dispatch])
  const onInviteClick = useCallback(
    () => dispatch(openDialog({ type: DialogType.PartyInvite })),
    [dispatch],
  )
  const onLeaveClick = useCallback(() => dispatch(leaveParty(partyId!)), [partyId, dispatch])
  const onKickPlayerClick = useCallback(
    (userId: SbUserId) => dispatch(kickPlayer(partyId!, userId)),
    [partyId, dispatch],
  )
  const onChangeLeaderClick = useCallback(
    (userId: SbUserId) => dispatch(changeLeader(partyId!, userId)),
    [partyId, dispatch],
  )

  useEffect(() => {
    if (partyId) {
      // The mismatch between the current URL and the party state can occur in a couple of ways. One
      // is when a user accepts an invite to a new party while already being a member of a different
      // party that is currently being rendered. Another way is that someone links to their own
      // party view while you're in a different party.
      if (routePartyId !== partyId) {
        replace(urlPath`/parties/${partyId}`)
      } else {
        dispatch(activateParty(partyId))
      }

      return () => dispatch(deactivateParty(partyId))
    } else {
      replace('/')
      return () => {}
    }
  }, [partyId, routePartyId, dispatch])

  if (!party) {
    // We expect that the useEffect above will navigate us away from here after this render anyway
    return <Container />
  }

  return (
    <Container>
      <StyledChat
        listProps={{
          messages: party.messages,
          renderMessage: renderPartyMessage,
        }}
        inputProps={{
          onSendChatMessage,
          storageKey: `party.${partyId}`,
        }}
      />
      <RightSide>
        <UserList
          party={party}
          selfUser={selfUser}
          onKickPlayer={onKickPlayerClick}
          onChangeLeader={onChangeLeaderClick}
        />
        {queueId ? (
          <CancelQueueButton
            iconStart={<SearchOffIcon />}
            label='Cancel search'
            onClick={onCancelQueueClick}
          />
        ) : null}
        {selfUser.id === party.leader ? (
          <TextButton
            iconStart={<StyledInviteIcon />}
            label='Invite players'
            onClick={onInviteClick}
          />
        ) : null}
        <TextButton iconStart={<CloseIcon />} label='Leave party' onClick={onLeaveClick} />
      </RightSide>
    </Container>
  )
}
