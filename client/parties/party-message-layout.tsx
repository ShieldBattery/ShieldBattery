import React from 'react'
import { ConnectedUsername } from '../messaging/connected-username'
import { SystemImportant, SystemMessage } from '../messaging/message-layout'

export const SelfJoinPartyMessage = React.memo<{ time: number; leaderId: number }>(props => {
  const { time, leaderId } = props
  return (
    <SystemMessage time={time}>
      <span>
        You have joined the party. The leader is{' '}
        <SystemImportant>
          <ConnectedUsername userId={leaderId} />
        </SystemImportant>
        .
      </span>
    </SystemMessage>
  )
})

export const InviteToPartyMessage = React.memo<{ time: number; userId: number }>(props => {
  const { time, userId } = props
  return (
    <SystemMessage time={time}>
      <span>
        &gt;&gt;{' '}
        <SystemImportant>
          <ConnectedUsername userId={userId} />
        </SystemImportant>{' '}
        has been invited to the party
      </span>
    </SystemMessage>
  )
})

export const JoinPartyMessage = React.memo<{ time: number; userId: number }>(props => {
  const { time, userId } = props
  return (
    <SystemMessage time={time}>
      <span>
        &gt;&gt;{' '}
        <SystemImportant>
          <ConnectedUsername userId={userId} />
        </SystemImportant>{' '}
        has joined the party
      </span>
    </SystemMessage>
  )
})

export const LeavePartyMessage = React.memo<{ time: number; userId: number }>(props => {
  const { time, userId } = props
  return (
    <SystemMessage time={time}>
      <span>
        &lt;&lt;{' '}
        <SystemImportant>
          <ConnectedUsername userId={userId} />
        </SystemImportant>{' '}
        has left the party
      </span>
    </SystemMessage>
  )
})
