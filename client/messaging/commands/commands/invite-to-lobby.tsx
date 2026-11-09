import { TFunction } from 'i18next'
import { getErrorStack } from '../../../../common/errors'
import { getLobbySeating } from '../../../../server/lib/lobbies/lobby-summaries'
import { getLobbyState, inviteToLobby, leaveLobby } from '../../../lobbies/action-creators'
import logger from '../../../logging/logger'
import { unblockUser, blockUser } from '../../../social/action-creators'
import { ArgSuggestDeps, ArgSuggestion, defineCommand } from '../command-schema'
import { selfTargetLine, notBlockedLine, relationshipFailedLine } from '../relationship-lines'
import { UndoLine } from '../undo-line'
import { resolveTarget } from './user-card'
import { getWhisperTargets } from './whisper'
import { ReactNode } from 'react'
import { Trans } from 'react-i18next'
import { SbUserId } from '../../../gql/types'
import { ConnectedUsername } from '../../../users/connected-username'
import { LocalStrong } from '../local-strong'

/** copy getWhisperTargets but exclude anybody already in the lobby */
function getInviteTargets({ context, getState }: ArgSuggestDeps): ArgSuggestion[] {
    const { lobby } = getState()
    const targets = getWhisperTargets({ context, getState })
    const inLobby = [
        ...lobby.info.teams.flatMap(team => team.slots.map(slot => slot?.userId)).filter(val => val != null),
        ...lobby.info.bench.map(b => b.userId)
    ]
    return targets.filter(t => t.user && !inLobby.includes(t.user?.id))
}


function invitedLine(userId: SbUserId, t: TFunction): ReactNode {
    return (
        <Trans t={t} i18nKey='chat.commands.invite.invited'>
            Invited 
            <LocalStrong>
                <ConnectedUsername userId={userId} />
            </LocalStrong>{' '}
            to lobby.
        </Trans>
    )
}

function inLobbyLine(userId: SbUserId, t: TFunction): ReactNode {
    return (
        <Trans t={t} i18nKey='chat.commands.invite.alreadyInLoby'>
            <LocalStrong>
                <ConnectedUsername userId={userId} />
            </LocalStrong>{' '}
            is already in the lobby.
        </Trans>
    )
}

export const inviteCommand = defineCommand({
    name: 'invite',
    description: t => t('chat.commands.leave.description', 'Leaves the channel or lobby you are in.'),
    group: 'matchmaking',
    surfaces: ['lobby'],
    args: [
        { kind: 'user', name: 'user', suggest: getInviteTargets },
    ],

    run(invocation) {
        const { context, dispatch, t, emit, } = invocation

        resolveTarget(invocation.args.user, invocation, target => {
            if (target.id === context.selfUserId) {
                emit({ kind: 'error', content: t("chat.commands.matchmaking.selfInvite", "You can't invite yourself to your lobby.") })
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
                                content: t("chat.commands.errors.lobbyInviteFailed", `Failed to invite ${target.id} to lobby`),
                            }),
                    }),
                )
            })
        })
    },
})
