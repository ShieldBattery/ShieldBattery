import React from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { assertUnreachable } from '../../common/assert-unreachable'
import { MatchmakingType, matchmakingTypeToLabel } from '../../common/matchmaking'
import { PartyQueueCancelReason } from '../../common/parties'
import { SbUserId } from '../../common/users/sb-user'
import { TransInterpolation } from '../i18n/i18next'
import { useChatUserMenuItems, useMentionFilterClick } from '../messaging/mention-hooks'
import { SystemImportant, SystemMessage } from '../messaging/message-layout'
import { ConnectedUsername } from '../users/connected-username'

export const SelfJoinPartyMessage = React.memo<{ time: number; leaderId: SbUserId }>(props => {
  const { time, leaderId } = props
  const { t } = useTranslation()
  const filterClick = useMentionFilterClick()
  const addChatMenuItems = useChatUserMenuItems()
  return (
    <SystemMessage time={time}>
      <span>
        <Trans t={t} i18nKey='parties.messageLayout.selfJoin'>
          You have joined the party. The leader is{' '}
          <SystemImportant>
            <ConnectedUsername
              userId={leaderId}
              filterClick={filterClick}
              modifyMenuItems={addChatMenuItems}
            />
          </SystemImportant>
          .
        </Trans>
      </span>
    </SystemMessage>
  )
})

export const InviteToPartyMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const { t } = useTranslation()
  const filterClick = useMentionFilterClick()
  const addChatMenuItems = useChatUserMenuItems()
  return (
    <SystemMessage time={time}>
      <span>
        <Trans t={t} i18nKey='parties.messageLayout.inviteToParty' shouldUnescape={true}>
          &gt;&gt;{' '}
          <SystemImportant>
            <ConnectedUsername
              userId={userId}
              filterClick={filterClick}
              modifyMenuItems={addChatMenuItems}
            />
          </SystemImportant>{' '}
          has been invited to the party
        </Trans>
      </span>
    </SystemMessage>
  )
})

export const JoinPartyMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const { t } = useTranslation()
  const filterClick = useMentionFilterClick()
  const addChatMenuItems = useChatUserMenuItems()
  return (
    <SystemMessage time={time}>
      <span>
        <Trans t={t} i18nKey='parties.messageLayout.joinParty' shouldUnescape={true}>
          &gt;&gt;{' '}
          <SystemImportant>
            <ConnectedUsername
              userId={userId}
              filterClick={filterClick}
              modifyMenuItems={addChatMenuItems}
            />
          </SystemImportant>{' '}
          has joined the party
        </Trans>
      </span>
    </SystemMessage>
  )
})

export const LeavePartyMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const { t } = useTranslation()
  const filterClick = useMentionFilterClick()
  const addChatMenuItems = useChatUserMenuItems()
  return (
    <SystemMessage time={time}>
      <span>
        <Trans t={t} i18nKey='parties.messageLayout.leaveParty' shouldUnescape={true}>
          &lt;&lt;{' '}
          <SystemImportant>
            <ConnectedUsername
              userId={userId}
              filterClick={filterClick}
              modifyMenuItems={addChatMenuItems}
            />
          </SystemImportant>{' '}
          has left the party
        </Trans>
      </span>
    </SystemMessage>
  )
})

export const PartyLeaderChangeMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const { t } = useTranslation()
  const filterClick = useMentionFilterClick()
  const addChatMenuItems = useChatUserMenuItems()
  return (
    <SystemMessage time={time}>
      <span>
        <Trans t={t} i18nKey='parties.messageLayout.leaderChange'>
          <SystemImportant>
            <ConnectedUsername
              userId={userId}
              filterClick={filterClick}
              modifyMenuItems={addChatMenuItems}
            />
          </SystemImportant>{' '}
          is now the leader
        </Trans>
      </span>
    </SystemMessage>
  )
})

export const KickFromPartyMessage = React.memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const { t } = useTranslation()
  const filterClick = useMentionFilterClick()
  const addChatMenuItems = useChatUserMenuItems()
  return (
    <SystemMessage time={time}>
      <span>
        <Trans t={t} i18nKey='parties.messageLayout.kickFromParty' shouldUnescape={true}>
          &lt;&lt;{' '}
          <SystemImportant>
            <ConnectedUsername
              userId={userId}
              filterClick={filterClick}
              modifyMenuItems={addChatMenuItems}
            />
          </SystemImportant>{' '}
          has been kicked from the party
        </Trans>
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
  const { t } = useTranslation()
  const filterClick = useMentionFilterClick()
  const addChatMenuItems = useChatUserMenuItems()
  return (
    <SystemMessage time={time}>
      <span>
        <Trans t={t} i18nKey='parties.messageLayout.queueStart'>
          <SystemImportant>
            <ConnectedUsername
              userId={leaderId}
              filterClick={filterClick}
              modifyMenuItems={addChatMenuItems}
            />
          </SystemImportant>{' '}
          is starting a search for a{' '}
          <SystemImportant>
            {{ matchmakingLabel: matchmakingTypeToLabel(matchmakingType, t) } as TransInterpolation}
          </SystemImportant>{' '}
          match
        </Trans>
      </span>
    </SystemMessage>
  )
})

export const PartyQueueCancelMessage = React.memo<{ time: number; reason: PartyQueueCancelReason }>(
  props => {
    const { time, reason } = props
    const { t } = useTranslation()
    const filterClick = useMentionFilterClick()
    const addChatMenuItems = useChatUserMenuItems()

    let messageContent: React.ReactNode
    switch (reason.type) {
      case 'error':
        messageContent = (
          <span>
            {t(
              'parties.messageLayout.queueCancel.error',
              'Matchmaking has been canceled due to an error',
            )}
          </span>
        )
        break
      case 'rejected':
        messageContent = (
          <span>
            <Trans t={t} i18nKey='parties.messageLayout.queueCancel.rejected'>
              <SystemImportant>
                <ConnectedUsername
                  userId={reason.user}
                  filterClick={filterClick}
                  modifyMenuItems={addChatMenuItems}
                />
              </SystemImportant>{' '}
              canceled matchmaking
            </Trans>
          </span>
        )
        break
      case 'userLeft':
        messageContent = (
          <span>
            <Trans t={t} i18nKey='parties.messageLayout.queueCancel.userLeft'>
              Matchmaking was canceled because{' '}
              <SystemImportant>
                <ConnectedUsername
                  userId={reason.user}
                  filterClick={filterClick}
                  modifyMenuItems={addChatMenuItems}
                />
              </SystemImportant>{' '}
              left the party
            </Trans>
          </span>
        )
        break
      case 'matchmakingDisabled':
        messageContent = (
          <span>
            {t(
              'parties.messageLayout.queueCancel.matchmakingDisabled',
              'Matchmaking was canceled because it is currently disabled',
            )}
          </span>
        )
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
  const { t } = useTranslation()
  return (
    <SystemMessage time={time}>
      <span>{t('parties.messageLayout.queueReady', 'The party is now searching for a match')}</span>
    </SystemMessage>
  )
})
