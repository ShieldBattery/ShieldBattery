import { TFunction } from 'i18next'
import { memo, useContext } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { LobbyChangedSetting } from '../../common/lobbies/lobby-network'
import { SbUserId } from '../../common/users/sb-user-id'
import { navigateToGameResults } from '../games/action-creators'
import { TransInterpolation } from '../i18n/i18next'
import { TextButton } from '../material/button'
import { ChatContext } from '../messaging/chat-context'
import { useMentionFilterClick } from '../messaging/mention-hooks'
import { SystemImportant, SystemMessage } from '../messaging/message-layout'
import { BodyMedium } from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'

export const JoinLobbyMessage = memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const { t } = useTranslation()
  const filterClick = useMentionFilterClick()
  const { UserMenu } = useContext(ChatContext)
  return (
    <SystemMessage time={time}>
      <span>
        &gt;&gt;{' '}
        <Trans t={t} i18nKey='lobbies.messageLayout.joinLobby'>
          <SystemImportant>
            <ConnectedUsername userId={userId} filterClick={filterClick} UserMenu={UserMenu} />
          </SystemImportant>{' '}
          has joined the lobby
        </Trans>
      </span>
    </SystemMessage>
  )
})

export const LeaveLobbyMessage = memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const { t } = useTranslation()
  const filterClick = useMentionFilterClick()
  const { UserMenu } = useContext(ChatContext)
  return (
    <SystemMessage time={time}>
      <span>
        &lt;&lt;{' '}
        <Trans t={t} i18nKey='lobbies.messageLayout.leaveLobby'>
          <SystemImportant>
            <ConnectedUsername userId={userId} filterClick={filterClick} UserMenu={UserMenu} />
          </SystemImportant>{' '}
          has left the lobby
        </Trans>
      </span>
    </SystemMessage>
  )
})

export const KickLobbyPlayerMessage = memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const { t } = useTranslation()
  const filterClick = useMentionFilterClick()
  const { UserMenu } = useContext(ChatContext)
  return (
    <SystemMessage time={time}>
      <span>
        &lt;&lt;{' '}
        <Trans t={t} i18nKey='lobbies.messageLayout.kickPlayer'>
          <SystemImportant>
            <ConnectedUsername userId={userId} filterClick={filterClick} UserMenu={UserMenu} />
          </SystemImportant>{' '}
          has been kicked from the lobby
        </Trans>
      </span>
    </SystemMessage>
  )
})

export const BanLobbyPlayerMessage = memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const { t } = useTranslation()
  const filterClick = useMentionFilterClick()
  const { UserMenu } = useContext(ChatContext)
  return (
    <SystemMessage time={time}>
      <span>
        &lt;&lt;{' '}
        <Trans t={t} i18nKey='lobbies.messageLayout.banPlayer'>
          <SystemImportant>
            <ConnectedUsername userId={userId} filterClick={filterClick} UserMenu={UserMenu} />
          </SystemImportant>{' '}
          has been banned from the lobby
        </Trans>
      </span>
    </SystemMessage>
  )
})

export const SelfJoinLobbyMessage = memo<{ time: number; lobby: string; hostId: SbUserId }>(
  props => {
    const { time, lobby, hostId } = props
    const { t } = useTranslation()
    const filterClick = useMentionFilterClick()
    const { UserMenu } = useContext(ChatContext)
    return (
      <SystemMessage time={time}>
        <span>
          <Trans t={t} i18nKey='lobbies.messageLayout.selfJoin'>
            You have joined <SystemImportant>{{ lobby } as TransInterpolation}</SystemImportant>.
            The host is{' '}
            <SystemImportant>
              <ConnectedUsername userId={hostId} filterClick={filterClick} UserMenu={UserMenu} />
            </SystemImportant>
            .
          </Trans>
        </span>
      </SystemMessage>
    )
  },
)

export const LobbyHostChangeMessage = memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const { t } = useTranslation()
  const filterClick = useMentionFilterClick()
  const { UserMenu } = useContext(ChatContext)
  return (
    <SystemMessage time={time}>
      <span>
        <Trans t={t} i18nKey='lobbies.messageLayout.hostChange'>
          <SystemImportant>
            <ConnectedUsername userId={userId} filterClick={filterClick} UserMenu={UserMenu} />
          </SystemImportant>{' '}
          is now the host
        </Trans>
      </span>
    </SystemMessage>
  )
})

export const LobbyCountdownStartedMessage = memo<{ time: number }>(props => {
  const { time } = props
  const { t } = useTranslation()
  return (
    <SystemMessage time={time}>
      <span>{t('lobbies.messageLayout.countdownStarted', 'The game countdown has begun')}</span>
    </SystemMessage>
  )
})

export const LobbyCountdownTickMessage = memo<{ time: number; timeLeft: number }>(props => {
  const { time, timeLeft } = props
  return (
    <SystemMessage time={time}>
      <span>{timeLeft}&hellip;</span>
    </SystemMessage>
  )
})

export const LobbyCountdownCanceledMessage = memo<{ time: number }>(props => {
  const { time } = props
  const { t } = useTranslation()
  return (
    <SystemMessage time={time}>
      <span>
        {t('lobbies.messageLayout.countdownCanceled', 'The game countdown has been canceled')}
      </span>
    </SystemMessage>
  )
})

const UserList = styled.ul<{ i18nIsDynamicList?: boolean }>`
  margin: 0;
  padding-left: 24px;

  & > li {
    text-indent: initial;
  }
`

export function LobbyLoadingCanceledMessage({
  time,
  usersAtFault,
}: {
  time: number
  usersAtFault?: ReadonlyArray<SbUserId>
}) {
  const { t } = useTranslation()
  const filterClick = useMentionFilterClick()
  const { UserMenu } = useContext(ChatContext)

  let text: React.ReactNode
  if (!usersAtFault?.length) {
    text = t(
      'lobbies.messageLayout.gameInitializationCanceled',
      'Game initialization has been canceled',
    )
  } else if (usersAtFault.length === 1) {
    const user = usersAtFault[0]
    text = (
      <Trans t={t} i18nKey={'lobbies.messageLayout.gameInitializationCanceledSingle'}>
        Game initialization has been canceled because{' '}
        <SystemImportant>
          <ConnectedUsername userId={user} filterClick={filterClick} UserMenu={UserMenu} />
        </SystemImportant>{' '}
        failed to load.
      </Trans>
    )
  } else {
    text = (
      <Trans t={t} i18nKey={'lobbies.messageLayout.gameInitializationCanceledMultiple'}>
        Game initialization has been canceled because the following players failed to load:
        <UserList i18nIsDynamicList>
          {usersAtFault.map(user => (
            <li key={user}>
              <SystemImportant>
                <ConnectedUsername userId={user} filterClick={filterClick} UserMenu={UserMenu} />
              </SystemImportant>
            </li>
          ))}
        </UserList>
      </Trans>
    )
  }

  return (
    <SystemMessage time={time}>
      <span>{text}</span>
    </SystemMessage>
  )
}

/** A short, human-readable label for a single changed lobby setting, used in a joined list. */
function changedSettingLabel(setting: LobbyChangedSetting, t: TFunction): string {
  switch (setting) {
    case 'name':
      return t('lobbies.messageLayout.settingsChangeName', 'lobby name')
    case 'map':
      return t('lobbies.messageLayout.settingsChangeMap', 'map')
    case 'gameType':
      return t('lobbies.messageLayout.settingsChangeGameType', 'game type')
    case 'gameSubType':
      return t('lobbies.messageLayout.settingsChangeGameSubType', 'teams')
    case 'useLegacyLimits':
      return t('lobbies.messageLayout.settingsChangeUnitLimit', 'unit limit')
    case 'allowObservers':
      return t('lobbies.messageLayout.settingsChangeObservers', 'observers')
    default:
      return assertUnreachable(setting)
  }
}

export const SettingsChangeMessage = memo<{
  time: number
  changedSettings: ReadonlyArray<LobbyChangedSetting>
}>(props => {
  const { time, changedSettings } = props
  const { t } = useTranslation()
  const settings = changedSettings.map(setting => changedSettingLabel(setting, t)).join(', ')

  return (
    <SystemMessage time={time}>
      <span>
        {t('lobbies.messageLayout.settingsChange', {
          defaultValue: 'The host changed the lobby settings: {{settings}}',
          settings,
        })}
      </span>
    </SystemMessage>
  )
})

export const BenchJoinMessage = memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const { t } = useTranslation()
  const filterClick = useMentionFilterClick()
  const { UserMenu } = useContext(ChatContext)
  return (
    <SystemMessage time={time}>
      <span>
        <Trans t={t} i18nKey='lobbies.messageLayout.benchJoin'>
          <SystemImportant>
            <ConnectedUsername userId={userId} filterClick={filterClick} UserMenu={UserMenu} />
          </SystemImportant>{' '}
          is waiting for a seat
        </Trans>
      </span>
    </SystemMessage>
  )
})

export const LobbyGameStartedMessage = memo<{ time: number }>(props => {
  const { time } = props
  const { t } = useTranslation()
  return (
    <SystemMessage time={time}>
      <span>{t('lobbies.messageLayout.gameStarted', 'The game has started')}</span>
    </SystemMessage>
  )
})

export const LobbyMemberGameEndedMessage = memo<{ time: number; userId: SbUserId }>(props => {
  const { time, userId } = props
  const { t } = useTranslation()
  const filterClick = useMentionFilterClick()
  const { UserMenu } = useContext(ChatContext)
  return (
    <SystemMessage time={time}>
      <span>
        <Trans t={t} i18nKey='lobbies.messageLayout.memberGameEnded'>
          <SystemImportant>
            <ConnectedUsername userId={userId} filterClick={filterClick} UserMenu={UserMenu} />
          </SystemImportant>{' '}
          has returned to the lobby
        </Trans>
      </span>
    </SystemMessage>
  )
})

const RegroupCard = styled.div`
  width: 100%;
  max-width: 320px;
  margin-top: 4px;
  padding: 8px 12px;
  /* The card renders as a block child of the message container, whose hanging-indent trick (see
   * MessageContainer in message-layout.tsx) is meant for message text only. */
  text-indent: 0;

  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;

  background-color: var(--theme-container-low);
  border: 1px solid var(--theme-outline-variant);
  border-radius: 8px;
`

/**
 * A small card announcing that a lobby's game has finished and everyone's back: the point of the
 * card (rather than a plain line of text) is the "View results" action, since the lobby itself no
 * longer shows the game once it's regrouped.
 */
export const LobbyRegroupMessage = memo<{ time: number; gameId: string }>(props => {
  const { time, gameId } = props
  const { t } = useTranslation()

  return (
    <SystemMessage time={time}>
      <RegroupCard>
        <BodyMedium>{t('lobbies.messageLayout.regroupTitle', 'Game finished')}</BodyMedium>
        <TextButton
          label={t('lobbies.messageLayout.regroupViewResults', 'View results')}
          onClick={() => navigateToGameResults(gameId)}
          testName='lobby-regroup-view-results-button'
        />
      </RegroupCard>
    </SystemMessage>
  )
})
