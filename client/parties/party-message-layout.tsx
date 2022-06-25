import React from 'react'
import { assertUnreachable } from '../../common/assert-unreachable'
import { MatchmakingType, matchmakingTypeToLabel } from '../../common/matchmaking'
import { PartyQueueCancelReason } from '../../common/parties'
import { SbUserId } from '../../common/users/sb-user'
import { useChatMenuItems, useMentionFilterClick } from '../messaging/mention-hooks'
import { SystemImportant, SystemMessage } from '../messaging/message-layout'
import { ConnectedUsername } from '../users/connected-username'

export const SelfJoinPartyMessage = React.memo<{ time: number; leaderId: SbUserId }>(props => {
  const { time, leaderId } = props
  const filterClick = useMentionFilterClick()
  const addChatMenuItems = useChatMenuItems()
  return (
    <SystemMessage time={time}>
      <span>
        You have joined the party. The leader is{' '}
        <SystemImportant>
          <ConnectedUsername
            userId={leaderId}
            filterClick={filterClick}
            modifyMenuItems={addChatMenuItems}
          />
        </SystemImportant>
        .
      </span>
    </SystemMessage>
  )
})

export const InviteToPartyMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const filterClick = useMentionFilterClick()
  const addChatMenuItems = useChatMenuItems()
  return (
    <SystemMessage time={time}>
      <span>
        &gt;&gt;{' '}
        <SystemImportant>
          <ConnectedUsername
            userId={userId}
            filterClick={filterClick}
            modifyMenuItems={addChatMenuItems}
          />
        </SystemImportant>{' '}
        has been invited to the party
      </span>
    </SystemMessage>
  )
})

export const JoinPartyMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const filterClick = useMentionFilterClick()
  const addChatMenuItems = useChatMenuItems()
  return (
    <SystemMessage time={time}>
      <span>
        &gt;&gt;{' '}
        <SystemImportant>
          <ConnectedUsername
            userId={userId}
            filterClick={filterClick}
            modifyMenuItems={addChatMenuItems}
          />
        </SystemImportant>{' '}
        has joined the party
      </span>
    </SystemMessage>
  )
})

export const LeavePartyMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const filterClick = useMentionFilterClick()
  const addChatMenuItems = useChatMenuItems()
  return (
    <SystemMessage time={time}>
      <span>
        &lt;&lt;{' '}
        <SystemImportant>
          <ConnectedUsername
            userId={userId}
            filterClick={filterClick}
            modifyMenuItems={addChatMenuItems}
          />
        </SystemImportant>{' '}
        has left the party
      </span>
    </SystemMessage>
  )
})

export const PartyLeaderChangeMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const filterClick = useMentionFilterClick()
  const addChatMenuItems = useChatMenuItems()
  return (
    <SystemMessage time={time}>
      <span>
        <SystemImportant>
          <ConnectedUsername
            userId={userId}
            filterClick={filterClick}
            modifyMenuItems={addChatMenuItems}
          />
        </SystemImportant>{' '}
        is now the leader
      </span>
    </SystemMessage>
  )
})

export const KickFromPartyMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const filterClick = useMentionFilterClick()
  const addChatMenuItems = useChatMenuItems()
  return (
    <SystemMessage time={time}>
      <span>
        &lt;&lt;{' '}
        <SystemImportant>
          <ConnectedUsername
            userId={userId}
            filterClick={filterClick}
            modifyMenuItems={addChatMenuItems}
          />
        </SystemImportant>{' '}
        has been kicked from the party
      </span>
    </SystemMessage>
  )
})

export const PartyQueueStartMessage = React.memo<{
  time: number
  leaderId: SbUserId
  matchmakingType: MatchmakingType
}>(props => {
  const { time, leaderId, matchmakingType } = props
  const filterClick = useMentionFilterClick()
  const addChatMenuItems = useChatMenuItems()
  return (
    <SystemMessage time={time}>
      <span>
        <SystemImportant>
          <ConnectedUsername
            userId={leaderId}
            filterClick={filterClick}
            modifyMenuItems={addChatMenuItems}
          />
        </SystemImportant>{' '}
        is starting a search for a{' '}
        <SystemImportant>{matchmakingTypeToLabel(matchmakingType)}</SystemImportant> match
      </span>
    </SystemMessage>
  )
})

export const PartyQueueCancelMessage = React.memo<{ time: number; reason: PartyQueueCancelReason }>(
  props => {
    const { time, reason } = props
    const filterClick = useMentionFilterClick()
    const addChatMenuItems = useChatMenuItems()

    let messageContent: React.ReactNode
    switch (reason.type) {
      case 'error':
        messageContent = <span>Matchmaking has been canceled due to an error</span>
        break
      case 'rejected':
        messageContent = (
          <span>
            <SystemImportant>
              <ConnectedUsername
                userId={reason.user}
                filterClick={filterClick}
                modifyMenuItems={addChatMenuItems}
              />
            </SystemImportant>{' '}
            canceled matchmaking
          </span>
        )
        break
      case 'userLeft':
        messageContent = (
          <span>
            Matchmaking was canceled because{' '}
            <SystemImportant>
              <ConnectedUsername
                userId={reason.user}
                filterClick={filterClick}
                modifyMenuItems={addChatMenuItems}
              />
            </SystemImportant>{' '}
            left the party
          </span>
        )
        break
      case 'matchmakingDisabled':
        messageContent = <span>Matchmaking was canceled because it is currently disabled</span>
        break
      default:
        assertUnreachable(reason)
    }

    return <SystemMessage time={time}>{messageContent}</SystemMessage>
  },
)

export const PartyQueueReadyMessage = React.memo<{
  time: number
}>(props => {
  const { time } = props
  return (
    <SystemMessage time={time}>
      <span>The party is now searching for a match</span>
    </SystemMessage>
  )
})
