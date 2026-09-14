import { TFunction } from 'i18next'
import * as React from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { assertUnreachable } from '../../../../common/assert-unreachable'
import { FriendActivityStatus } from '../../../../common/users/relationships'
import { SbUserId } from '../../../../common/users/sb-user-id'
import { TransInterpolation } from '../../../i18n/i18next'
import { MaterialIcon } from '../../../icons/material/material-icon'
import {
  acceptFriendRequest,
  getRelationshipsIfNeeded,
  removeFriend as removeFriendRelationship,
  sendFriendRequest,
} from '../../../social/action-creators'
import {
  getActivityDescriptor,
  useFriendActivityStatus,
} from '../../../social/friend-activity-status'
import { bodyMedium, labelMedium } from '../../../styles/typography'
import { ConnectedUsername } from '../../../users/connected-username'
import {
  ALL_COMMAND_SURFACES,
  ArgSuggestDeps,
  ArgSuggestion,
  CommandInvocation,
  defineCommand,
} from '../command-schema'
import { LocalStrong } from '../local-strong'
import { notOnFriendsListLine, relationshipFailedLine, selfTargetLine } from '../relationship-lines'
import { UndoLine } from '../undo-line'
import { resolveTarget } from './user-card'

/** Orders names the way a reader looks for them, rather than putting every capital first. */
const nameCollator = new Intl.Collator(navigator.language, { sensitivity: 'base' })

/** What the friend routines need from the invocation they run in. */
type FriendDeps = Pick<CommandInvocation, 'context' | 'dispatch' | 't' | 'emit'>

/** One friend as the list and the suggestions read them out of the store. */
interface FriendEntry {
  id: SbUserId
  /** Empty for a friend whose name hasn't arrived yet, which sorts them to the front. */
  name: string
  online: boolean
}

function byName(a: FriendEntry, b: FriendEntry): number {
  return nameCollator.compare(a.name, b.name)
}

/**
 * Every friend, online ones first and each group in name order. A friend with no activity reported
 * yet counts as offline, which is what the friends list itself shows them as.
 */
function getFriends({ getState }: Pick<ArgSuggestDeps, 'getState'>): FriendEntry[] {
  const { relationships, users } = getState()
  const entries: FriendEntry[] = []
  for (const id of relationships.friends.keys()) {
    entries.push({
      id,
      name: users.byId.get(id)?.name ?? '',
      online:
        (relationships.friendActivityStatus.get(id) ?? FriendActivityStatus.Offline) !==
        FriendActivityStatus.Offline,
    })
  }

  return [
    ...entries.filter(entry => entry.online).sort(byName),
    ...entries.filter(entry => !entry.online).sort(byName),
  ]
}

/** Only a friend can be unfriended, so the friends list is the whole of what the argument takes. */
function getFriendSuggestions(deps: ArgSuggestDeps): ArgSuggestion[] {
  return getFriends(deps)
    .filter(entry => entry.name !== '')
    .map(entry => ({ value: entry.name, user: { id: entry.id, online: entry.online } }))
}

function alreadyFriendsLine(userId: SbUserId, t: TFunction): React.ReactNode {
  return (
    <Trans t={t} i18nKey='chat.commands.friend.alreadyFriends'>
      You're already friends with{' '}
      <LocalStrong>
        <ConnectedUsername userId={userId} />
      </LocalStrong>
      .
    </Trans>
  )
}

function alreadyRequestedLine(userId: SbUserId, t: TFunction): React.ReactNode {
  return (
    <Trans t={t} i18nKey='chat.commands.friend.alreadyRequested'>
      You've already sent{' '}
      <LocalStrong>
        <ConnectedUsername userId={userId} />
      </LocalStrong>{' '}
      a friend request.
    </Trans>
  )
}

function nowFriendsLine(userId: SbUserId, t: TFunction): React.ReactNode {
  return (
    <Trans t={t} i18nKey='chat.commands.friend.nowFriends'>
      You're now friends with{' '}
      <LocalStrong>
        <ConnectedUsername userId={userId} />
      </LocalStrong>
      .
    </Trans>
  )
}

function requestSentLine(userId: SbUserId, t: TFunction): React.ReactNode {
  return (
    <Trans t={t} i18nKey='chat.commands.friend.requestSent'>
      Friend request sent to{' '}
      <LocalStrong>
        <ConnectedUsername userId={userId} />
      </LocalStrong>
      .
    </Trans>
  )
}

function removedFriendLine(userId: SbUserId, t: TFunction): React.ReactNode {
  return (
    <Trans t={t} i18nKey='chat.commands.unfriend.removed'>
      Removed{' '}
      <LocalStrong>
        <ConnectedUsername userId={userId} />
      </LocalStrong>{' '}
      from your friends.
    </Trans>
  )
}

/**
 * Befriends a user: accepts the request they already sent if there is one, and otherwise sends
 * them one. What the client knows of the relationship is only used to answer without a request
 * where it can; until the relationships have loaded the server decides, and its refusals say the
 * same things.
 */
export function addFriend(target: { id: SbUserId }, deps: FriendDeps): void {
  const { context, dispatch, t, emit } = deps

  if (target.id === context.selfUserId) {
    emit({ kind: 'error', content: selfTargetLine('friend', t) })
    return
  }

  dispatch((_, getState) => {
    const { relationships } = getState()

    if (relationships.loaded) {
      if (relationships.friends.has(target.id)) {
        emit({ kind: 'info', content: alreadyFriendsLine(target.id, t) })
        return
      }
      if (relationships.outgoingRequests.has(target.id)) {
        emit({ kind: 'info', content: alreadyRequestedLine(target.id, t) })
        return
      }
      if (relationships.incomingRequests.has(target.id)) {
        dispatch(
          acceptFriendRequest(target.id, {
            onSuccess: () => emit({ kind: 'info', content: nowFriendsLine(target.id, t) }),
            onError: err =>
              emit({
                kind: 'error',
                content: relationshipFailedLine('accept', target.id, err, t),
              }),
          }),
        )
        return
      }
    }

    dispatch(
      sendFriendRequest(target.id, {
        onSuccess: () => emit({ kind: 'info', content: requestSentLine(target.id, t) }),
        onError: err =>
          emit({ kind: 'error', content: relationshipFailedLine('friend', target.id, err, t) }),
      }),
    )
  })
}

/**
 * Removes a user from the running user's friends. Undoing that can only send a fresh friend
 * request, since the other side has to agree to a friendship again, which is what the undone line
 * says.
 */
export function removeFriend(target: { id: SbUserId }, deps: FriendDeps): void {
  const { context, dispatch, t, emit } = deps

  if (target.id === context.selfUserId) {
    emit({ kind: 'error', content: selfTargetLine('unfriend', t) })
    return
  }

  dispatch((_, getState) => {
    const { relationships } = getState()
    if (relationships.loaded && !relationships.friends.has(target.id)) {
      emit({ kind: 'error', content: notOnFriendsListLine(target.id, t) })
      return
    }

    dispatch(
      removeFriendRelationship(target.id, {
        onSuccess: () =>
          emit({
            kind: 'info',
            content: (
              <UndoLine
                content={removedFriendLine(target.id, t)}
                undoneContent={requestSentLine(target.id, t)}
                undo={spec => sendFriendRequest(target.id, spec)}
                onUndoError={err =>
                  emit({
                    kind: 'error',
                    content: relationshipFailedLine('friend', target.id, err, t),
                  })
                }
              />
            ),
          }),
        onError: err =>
          emit({ kind: 'error', content: relationshipFailedLine('unfriend', target.id, err, t) }),
      }),
    )
  })
}

const FriendListRoot = styled.div`
  ${bodyMedium};
  color: var(--color-blue90);
`

// Every row is one line tall whatever it holds (a name too long for the line is clipped rather than
// wrapped), so the block's height is what the number of friends says it is and nothing in a row can
// push the conversation around as it updates.
const FriendRow = styled.div<{ $offline: boolean }>`
  height: 20px;
  line-height: 20px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: ${props => (props.$offline ? 0.5 : 1)};
`

const FriendName = styled(LocalStrong)`
  color: var(--color-blue95);
`

const ActivityLabel = styled.span<{ $color: string }>`
  ${labelMedium};
  display: inline-flex;
  align-items: center;
  gap: 4px;
  vertical-align: top;
  line-height: 20px;
  color: ${props => props.$color};
`

function FriendListRow({ userId }: { userId: SbUserId }) {
  const { t } = useTranslation()
  const status = useFriendActivityStatus(userId)
  const descriptor = getActivityDescriptor(status, t)

  return (
    <FriendRow $offline={(status ?? FriendActivityStatus.Offline) === FriendActivityStatus.Offline}>
      <FriendName>
        <ConnectedUsername userId={userId} />
      </FriendName>
      {descriptor ? (
        <>
          {' '}
          <ActivityLabel $color={descriptor.color}>
            <MaterialIcon icon={descriptor.icon} size={14} />
            {descriptor.label}
          </ActivityLabel>
        </>
      ) : undefined}
    </FriendRow>
  )
}

/**
 * The friends a `/f list` answered with, one per row. Which friends are listed is fixed when the
 * answer is given, so a friendship made or ended afterwards doesn't rewrite a line that has already
 * been read; what each row says the friend is doing stays live.
 */
export function FriendListBlock({ userIds }: { userIds: ReadonlyArray<SbUserId> }) {
  return (
    <FriendListRoot>
      {userIds.map(userId => (
        <FriendListRow key={userId} userId={userId} />
      ))}
    </FriendListRoot>
  )
}

function friendsHeaderLine(online: number, offline: number, t: TFunction): React.ReactNode {
  return (
    <Trans t={t} i18nKey='chat.commands.friends.header'>
      Friends ({{ online } as TransInterpolation} online, {{ offline } as TransInterpolation}{' '}
      offline):
    </Trans>
  )
}

/** Answers with who the running user's friends are and what each of them is doing. */
function listFriends({ dispatch, t, emit }: FriendDeps): void {
  dispatch(
    getRelationshipsIfNeeded({
      onSuccess: () =>
        dispatch((_, getState) => {
          const friends = getFriends({ getState })
          if (!friends.length) {
            emit({
              kind: 'info',
              content: t('chat.commands.friends.empty', 'Your friends list is empty.'),
            })
            return
          }

          const onlineCount = friends.filter(entry => entry.online).length
          emit({
            kind: 'info',
            content: friendsHeaderLine(onlineCount, friends.length - onlineCount, t),
          })
          emit({
            kind: 'card',
            content: <FriendListBlock userIds={friends.map(entry => entry.id)} />,
          })
        }),
      onError: err =>
        emit({
          kind: 'error',
          content: t('chat.commands.friends.loadError', {
            defaultValue: "Couldn't load your friends list: {{errorMessage}}",
            errorMessage: err.message,
          }),
        }),
    }),
  )
}

export const friendCommand = defineCommand({
  name: 'friend',
  description: t => t('chat.commands.friend.description', 'Sends a friend request to a user.'),
  surfaces: ALL_COMMAND_SURFACES,
  args: [{ kind: 'user', name: 'user' }],

  run(invocation) {
    resolveTarget(invocation.args.user, invocation, target => addFriend(target, invocation))
  },
})

export const unfriendCommand = defineCommand({
  name: 'unfriend',
  description: t => t('chat.commands.unfriend.description', 'Removes a user from your friends.'),
  surfaces: ALL_COMMAND_SURFACES,
  args: [{ kind: 'user', name: 'user', exhaustive: true, suggest: getFriendSuggestions }],

  run(invocation) {
    resolveTarget(invocation.args.user, invocation, target => removeFriend(target, invocation))
  },
})

export const friendsCommand = defineCommand({
  name: 'f',
  aliases: ['friends'],
  description: t =>
    t(
      'chat.commands.friends.description',
      'Manages your friends list: add, remove, or list them with their current activity.',
    ),
  surfaces: ALL_COMMAND_SURFACES,
  args: [
    {
      kind: 'subcommand',
      name: 'action',
      options: [
        {
          name: 'add',
          aliases: ['a'],
          description: t =>
            t(
              'chat.commands.friends.add.description',
              'Sends a friend request, or accepts a pending one.',
            ),
          args: [{ kind: 'user', name: 'user' }],
        },
        {
          name: 'remove',
          aliases: ['r'],
          description: t =>
            t('chat.commands.friends.remove.description', 'Removes a user from your friends.'),
          args: [{ kind: 'user', name: 'user', exhaustive: true, suggest: getFriendSuggestions }],
        },
        {
          name: 'list',
          aliases: ['l'],
          description: t =>
            t(
              'chat.commands.friends.list.description',
              'Lists your friends and what they are doing.',
            ),
          args: [],
        },
      ],
    },
  ],

  run(invocation) {
    const action = invocation.args.action

    switch (action.name) {
      case 'add':
        resolveTarget(action.args.user, invocation, target => addFriend(target, invocation))
        break
      case 'remove':
        resolveTarget(action.args.user, invocation, target => removeFriend(target, invocation))
        break
      case 'list':
        listFriends(invocation)
        break
      default:
        assertUnreachable(action)
    }
  },
})
