import { TFunction } from 'i18next'
import * as React from 'react'
import { Trans } from 'react-i18next'
import { SbUserId } from '../../../../common/users/sb-user-id'
import { blockUser, unblockUser } from '../../../social/action-creators'
import { ConnectedUsername } from '../../../users/connected-username'
import {
  ALL_COMMAND_SURFACES,
  ArgSuggestDeps,
  ArgSuggestion,
  defineCommand,
} from '../command-schema'
import { LocalStrong } from '../local-strong'
import { notBlockedLine, relationshipFailedLine, selfTargetLine } from '../relationship-lines'
import { UndoLine } from '../undo-line'
import { resolveTarget } from './user-card'

/** Orders names the way a reader looks for them, rather than putting every capital first. */
const nameCollator = new Intl.Collator(navigator.language, { sensitivity: 'base' })

/**
 * Only a blocked user can be unblocked, so the block list is the whole of what the argument takes.
 * A block says nothing about whether the blocked user is around, so no row claims a presence.
 */
function getBlockSuggestions({ getState }: ArgSuggestDeps): ArgSuggestion[] {
  const { relationships, users } = getState()
  const entries: Array<{ id: SbUserId; name: string }> = []
  for (const id of relationships.blocks.keys()) {
    const name = users.byId.get(id)?.name
    if (name !== undefined) {
      entries.push({ id, name })
    }
  }

  return entries
    .sort((a, b) => nameCollator.compare(a.name, b.name))
    .map(entry => ({ value: entry.name, user: { id: entry.id } }))
}

function alreadyBlockedLine(userId: SbUserId, t: TFunction): React.ReactNode {
  return (
    <Trans t={t} i18nKey='chat.commands.block.alreadyBlocked'>
      <LocalStrong>
        <ConnectedUsername userId={userId} />
      </LocalStrong>{' '}
      is already blocked.
    </Trans>
  )
}

function blockedLine(userId: SbUserId, t: TFunction): React.ReactNode {
  return (
    <Trans t={t} i18nKey='chat.commands.block.blocked'>
      Blocked{' '}
      <LocalStrong>
        <ConnectedUsername userId={userId} />
      </LocalStrong>
      . Their messages are hidden here and in any game you launch from now on.
    </Trans>
  )
}

function unblockedLine(userId: SbUserId, t: TFunction): React.ReactNode {
  return (
    <Trans t={t} i18nKey='chat.commands.unblock.unblocked'>
      Unblocked{' '}
      <LocalStrong>
        <ConnectedUsername userId={userId} />
      </LocalStrong>
      .
    </Trans>
  )
}

function blockedAgainLine(userId: SbUserId, t: TFunction): React.ReactNode {
  return (
    <Trans t={t} i18nKey='chat.commands.block.blockedAgain'>
      Blocked{' '}
      <LocalStrong>
        <ConnectedUsername userId={userId} />
      </LocalStrong>{' '}
      again.
    </Trans>
  )
}

export const blockCommand = defineCommand({
  name: 'block',
  aliases: ['ignore', 'squelch'],
  description: t =>
    t(
      'chat.commands.block.description',
      'Blocks a user: hides their messages here and in any game you launch.',
    ),
  surfaces: ALL_COMMAND_SURFACES,
  args: [{ kind: 'user', name: 'user' }],

  run(invocation) {
    const { context, dispatch, t, emit } = invocation

    resolveTarget(invocation.args.user, invocation, target => {
      if (target.id === context.selfUserId) {
        emit({ kind: 'error', content: selfTargetLine('block', t) })
        return
      }

      dispatch((_, getState) => {
        const { relationships } = getState()
        if (relationships.loaded && relationships.blocks.has(target.id)) {
          emit({ kind: 'info', content: alreadyBlockedLine(target.id, t) })
          return
        }

        dispatch(
          blockUser(target.id, {
            onSuccess: () =>
              emit({
                kind: 'info',
                content: (
                  <UndoLine
                    content={blockedLine(target.id, t)}
                    undoneContent={unblockedLine(target.id, t)}
                    undo={spec => unblockUser(target.id, spec)}
                    onUndoError={err =>
                      emit({
                        kind: 'error',
                        content: relationshipFailedLine('unblock', target.id, err, t),
                      })
                    }
                  />
                ),
              }),
            onError: err =>
              emit({ kind: 'error', content: relationshipFailedLine('block', target.id, err, t) }),
          }),
        )
      })
    })
  },
})

export const unblockCommand = defineCommand({
  name: 'unblock',
  aliases: ['unignore', 'unsquelch'],
  description: t => t('chat.commands.unblock.description', 'Unblocks a user.'),
  surfaces: ALL_COMMAND_SURFACES,
  args: [{ kind: 'user', name: 'user', exhaustive: true, suggest: getBlockSuggestions }],

  run(invocation) {
    const { context, dispatch, t, emit } = invocation

    resolveTarget(invocation.args.user, invocation, target => {
      if (target.id === context.selfUserId) {
        emit({ kind: 'error', content: selfTargetLine('unblock', t) })
        return
      }

      dispatch((_, getState) => {
        const { relationships } = getState()
        if (relationships.loaded && !relationships.blocks.has(target.id)) {
          emit({ kind: 'error', content: notBlockedLine(target.id, t) })
          return
        }

        dispatch(
          unblockUser(target.id, {
            onSuccess: () =>
              emit({
                kind: 'info',
                content: (
                  <UndoLine
                    content={unblockedLine(target.id, t)}
                    undoneContent={blockedAgainLine(target.id, t)}
                    undo={spec => blockUser(target.id, spec)}
                    onUndoError={err =>
                      emit({
                        kind: 'error',
                        content: relationshipFailedLine('block', target.id, err, t),
                      })
                    }
                  />
                ),
              }),
            onError: err =>
              emit({
                kind: 'error',
                content: relationshipFailedLine('unblock', target.id, err, t),
              }),
          }),
        )
      })
    })
  },
})
