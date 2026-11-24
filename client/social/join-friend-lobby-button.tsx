import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user-id'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconButton, TextButton } from '../material/button'
import { Tooltip } from '../material/tooltip'
import { useJoinFriendLobby } from './join-friend-lobby'

const RowIconButton = styled(IconButton)`
  width: 32px;
  min-height: 32px;
  height: 32px;
  flex-shrink: 0;

  /* Matches the color of the "In lobby" status this joins. */
  color: var(--theme-positive);
`

const ButtonTooltip = styled(Tooltip)`
  flex-shrink: 0;
`

/**
 * A compact icon-only button, for a row showing a user, that joins the lobby a friend is in.
 * Renders nothing when there's no lobby to join (see `useJoinFriendLobby`). Its clicks don't reach
 * the row it sits in. `onJoin` runs when it's clicked, before the join, for a row to react to the
 * join (e.g. closing a sidebar).
 */
export function JoinFriendLobbyIconButton({
  userId,
  onJoin,
  className,
}: {
  userId: SbUserId
  onJoin?: () => void
  className?: string
}) {
  const { t } = useTranslation()
  const joinFriendLobby = useJoinFriendLobby(userId)

  if (!joinFriendLobby) {
    return null
  }

  const { lobby, join, isPending } = joinFriendLobby
  const label = t('users.activityStatus.joinLobby', {
    defaultValue: 'Join lobby: {{lobbyName}}',
    lobbyName: lobby.name,
  })

  return (
    <ButtonTooltip text={label} position='left' tabIndex={-1} className={className}>
      <RowIconButton
        icon={<MaterialIcon icon='login' size={20} />}
        ariaLabel={label}
        disabled={isPending}
        onClick={event => {
          // Rows that are links would otherwise navigate, and rows that open an overlay would
          // open it.
          event.preventDefault()
          event.stopPropagation()
          onJoin?.()
          join()
        }}
      />
    </ButtonTooltip>
  )
}

const JoinTextButton = styled(TextButton)`
  flex-shrink: 0;
  min-height: 32px;
`

/**
 * A text button, for places with room for one, that joins the lobby a friend is in. Renders nothing
 * when there's no lobby to join (see `useJoinFriendLobby`). `onJoin` runs when it's clicked, before
 * the join.
 */
export function JoinFriendLobbyTextButton({
  userId,
  onJoin,
  className,
}: {
  userId: SbUserId
  onJoin?: () => void
  className?: string
}) {
  const { t } = useTranslation()
  const joinFriendLobby = useJoinFriendLobby(userId)

  if (!joinFriendLobby) {
    return null
  }

  const { lobby, join, isPending } = joinFriendLobby

  return (
    <ButtonTooltip
      text={t('users.activityStatus.joinLobby', {
        defaultValue: 'Join lobby: {{lobbyName}}',
        lobbyName: lobby.name,
      })}
      tabIndex={-1}
      className={className}>
      <JoinTextButton
        label={t('users.profileOverlay.joinLobby', 'Join lobby')}
        iconStart='login'
        disabled={isPending}
        onClick={() => {
          onJoin?.()
          join()
        }}
      />
    </ButtonTooltip>
  )
}
