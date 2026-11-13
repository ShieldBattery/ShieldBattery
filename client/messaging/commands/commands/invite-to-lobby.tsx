import { TFunction } from 'i18next'
import { ReactNode } from 'react'
import { Trans } from 'react-i18next'
import { SbUserId } from '../../../gql/types'
import { inviteToLobby } from '../../../lobbies/action-creators'
import { lobbyInviteErrorMessage } from '../../../lobbies/lobby-invite-errors'
import { ConnectedUsername } from '../../../users/connected-username'
import { ArgSuggestDeps, ArgSuggestion, defineCommand } from '../command-schema'
import { LocalStrong } from '../local-strong'
import { resolveTarget } from './user-card'
import { getWhisperTargets } from './whisper'
import { getLobbyPlayers } from '../../../../common/lobbies'

/** copy getWhisperTargets but exclude anybody already in the lobby */
function getInviteTargets({ context, getState }: ArgSuggestDeps): ArgSuggestion[] {
  const { lobby } = getState()
  const targets = getWhisperTargets({ context, getState })
  return targets.filter(t => t.user && !getLobbyPlayers(lobby.info).includes(t.user?.id))
}

function invitedLine(userId: SbUserId, t: TFunction): ReactNode {
  return (
    <Trans t={t} i18nKey='chat.commands.invite.invited'>
      Invited{' '}
      <LocalStrong>
        <ConnectedUsername userId={userId} />
      </LocalStrong>{' '}
      to lobby.
    </Trans>
  )
}

export const inviteCommand = defineCommand({
  name: 'invite',
  description: t => t('chat.commands.invite.description', 'Invites another user to your lobby.'),
  group: 'matchmaking',
  surfaces: ['lobby'],
  args: [{ kind: 'user', name: 'user', suggest: getInviteTargets }],

  run(invocation) {
    const { context, dispatch, t, emit } = invocation

    resolveTarget(invocation.args.user, invocation, target => {
      if (target.id === context.selfUserId) {
        emit({
          kind: 'error',
          content: t(
            'chat.commands.matchmaking.selfInvite',
            "You can't invite yourself to your lobby.",
          ),
        })
        return
      }

      dispatch((_, getState) => {
        dispatch(
          inviteToLobby(target.id, {
            onSuccess: () =>
              emit({
                kind: 'info',
                content: invitedLine(target.id, t),
              }),
            onError: err =>
              emit({
                kind: 'error',
                content: lobbyInviteErrorMessage(err, t),
              }),
          }),
        )
      })
    })
  },
})
