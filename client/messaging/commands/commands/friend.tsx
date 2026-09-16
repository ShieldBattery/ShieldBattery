import { TFunction } from 'i18next'
import * as React from 'react'
import { useLayoutEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { assertUnreachable } from '../../../../common/assert-unreachable'
import { FriendActivityStatus } from '../../../../common/users/relationships'
import { SbUserId } from '../../../../common/users/sb-user-id'
import { ConnectedAvatar } from '../../../avatars/avatar'
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
import { bodySmall, labelMedium, singleLine, titleSmall } from '../../../styles/typography'
import { ConnectedUsername } from '../../../users/connected-username'
import { INLINE_CARD_PADDING, inlineCardBase } from '../../inline-card'
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
    <Trans t={t} i18nKey='chat.commands.friends.add.alreadyFriends'>
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
    <Trans t={t} i18nKey='chat.commands.friends.add.alreadyRequested'>
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
    <Trans t={t} i18nKey='chat.commands.friends.add.nowFriends'>
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
    <Trans t={t} i18nKey='chat.commands.friends.add.requestSent'>
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
    <Trans t={t} i18nKey='chat.commands.friends.remove.removed'>
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

// The roster card's own shell: the shared inline-card surface at its natural height (unlike the
// fixed-height cards in `inline-card.ts`, this one's height is just whatever its rows add up to).
const CardRoot = styled.div`
  ${inlineCardBase};
  padding: ${INLINE_CARD_PADDING}px;
`

// The count trails the tracked-out overline label in a lighter, untracked tone so it doesn't read
// as part of the all-caps heading.
const Count = styled.span`
  color: rgb(from var(--theme-on-surface-variant) r g b / 0.5);
  letter-spacing: 0.4px;
`

const OnlineOverline = styled.div`
  ${labelMedium};
  height: 20px;
  padding: 0 4px;

  display: flex;
  align-items: center;
  gap: 4px;

  color: rgb(from var(--theme-on-surface-variant) r g b / 0.72);
  text-transform: uppercase;
  letter-spacing: 1.6px;
`

const NoneOnlineRow = styled.div`
  ${bodySmall};
  height: 28px;
  padding: 0 4px;

  display: flex;
  align-items: center;

  color: rgb(from var(--theme-on-surface-variant) r g b / 0.6);
`

// Styled like the overline above it, but as a real button: hover/focus give it a background so it
// reads as interactive, and expanding swaps its chevron for a down-arrow to say what it now does.
const DisclosureButton = styled.button.attrs({ type: 'button' })`
  ${labelMedium};
  height: 20px;
  width: 100%;
  margin: 4px 0 0;
  padding: 0 4px;

  display: flex;
  align-items: center;
  gap: 4px;

  background: none;
  border: 0;
  border-radius: 4px;
  color: rgb(from var(--theme-on-surface-variant) r g b / 0.72);
  text-align: left;
  text-transform: uppercase;
  letter-spacing: 1.6px;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    color: var(--theme-on-surface-variant);
    background-color: rgb(from var(--theme-on-surface) r g b / 0.06);
  }

  &:focus-visible {
    outline: 2px solid var(--theme-primary);
    outline-offset: -2px;
  }
`

const DisclosureIcon = styled(MaterialIcon)`
  margin-left: -4px;
`

// One line tall whatever it holds, so the card's height is exactly its row count times a row's
// height and nothing in a row (an overlong name, say) can push the rest of the card around.
const FriendRowRoot = styled.div`
  height: 28px;
  padding: 0 4px;

  display: flex;
  align-items: center;
  gap: 8px;

  border-radius: 4px;

  &:hover {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
  }
`

const RowAvatar = styled(ConnectedAvatar)<{ $offline: boolean }>`
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  opacity: ${props => (props.$offline ? 'var(--theme-disabled-opacity)' : '1')};
`

const RowName = styled.span<{ $offline: boolean }>`
  ${titleSmall};
  ${singleLine};
  flex: 1;
  min-width: 0;
  color: ${props => (props.$offline ? 'var(--theme-on-surface-variant)' : 'var(--theme-on-surface)')};
`

const RowActivity = styled.span<{ $color: string }>`
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;

  ${labelMedium};
  color: ${props => props.$color};
`

function FriendRow({ userId, offline }: { userId: SbUserId; offline: boolean }) {
  const { t } = useTranslation()
  const status = useFriendActivityStatus(userId)
  // An offline friend never has an activity to report, but the row still gates on `offline`
  // directly rather than leaning on that to stay true.
  const descriptor = offline ? undefined : getActivityDescriptor(status, t)

  return (
    <FriendRowRoot>
      <RowAvatar userId={userId} $offline={offline} />
      <RowName $offline={offline}>
        <ConnectedUsername userId={userId} />
      </RowName>
      {descriptor ? (
        <RowActivity $color={descriptor.color}>
          <MaterialIcon icon={descriptor.icon} size={16} />
          {descriptor.label}
        </RowActivity>
      ) : null}
    </FriendRowRoot>
  )
}

/**
 * The friends a `/f list` answered with, split into who was online and who wasn't at that moment.
 * That split is fixed when the answer is given, so a friendship made or ended afterwards, or a
 * friend crossing between online and offline, doesn't move anyone between the two groups or rewrite
 * a row that has already been read; what each row says the friend is doing stays live.
 *
 * The online rows always show, with a quiet placeholder row when there aren't any. The offline
 * rows start collapsed behind a disclosure row and are inserted below it once it's opened, so the
 * disclosure stays put between the two groups in both states; it only renders when there's an
 * offline friend to show.
 */
export function FriendListCard({
  onlineIds,
  offlineIds,
}: {
  onlineIds: ReadonlyArray<SbUserId>
  offlineIds: ReadonlyArray<SbUserId>
}) {
  const { t } = useTranslation()
  const [offlineShown, setOfflineShown] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const wasOfflineShown = useRef(offlineShown)

  useLayoutEffect(() => {
    // The card usually sits at the bottom of the chat, so rows the disclosure adds land below the
    // fold; nothing else re-scrolls the view for content that grows after it's already been read.
    if (offlineShown && !wasOfflineShown.current) {
      rootRef.current?.scrollIntoView({ block: 'nearest' })
    }
    wasOfflineShown.current = offlineShown
  }, [offlineShown])

  return (
    <CardRoot ref={rootRef}>
      <OnlineOverline>
        {t('social.friendsList.header.online', 'Online')} <Count>({onlineIds.length})</Count>
      </OnlineOverline>
      {onlineIds.length > 0 ? (
        onlineIds.map(userId => <FriendRow key={userId} userId={userId} offline={false} />)
      ) : (
        <NoneOnlineRow>
          {t('chat.commands.friends.list.noneOnline', 'No friends online')}
        </NoneOnlineRow>
      )}
      {offlineIds.length > 0 ? (
        <DisclosureButton
          aria-expanded={offlineShown}
          onClick={() => setOfflineShown(shown => !shown)}>
          <DisclosureIcon icon={offlineShown ? 'expand_more' : 'chevron_right'} size={18} />
          {t('social.friendsList.header.offline', 'Offline')} <Count>({offlineIds.length})</Count>
        </DisclosureButton>
      ) : null}
      {offlineShown
        ? offlineIds.map(userId => <FriendRow key={userId} userId={userId} offline={true} />)
        : null}
    </CardRoot>
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

          const onlineIds = friends.filter(entry => entry.online).map(entry => entry.id)
          const offlineIds = friends.filter(entry => !entry.online).map(entry => entry.id)
          emit({
            kind: 'card',
            content: <FriendListCard onlineIds={onlineIds} offlineIds={offlineIds} />,
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

export const friendsCommand = defineCommand({
  name: 'f',
  aliases: ['friends'],
  description: t =>
    t(
      'chat.commands.friends.description',
      'Manages your friends list: add, remove, or list them with their current activity.',
    ),
  group: 'people',
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
