import { useAtomValue } from 'jotai'
import { AnimatePresence, m } from 'motion/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { getGameDurationString } from '../../common/games/games'
import { MS_PER_GAME_FRAME } from '../../common/games/replay-timestamp'
import {
  makeSbReplaySessionId,
  ReplaySessionErrorCode,
  ReplaySessionInviteJson,
  ReplaySessionJson,
  ReplaySessionMemberJson,
} from '../../common/replay-sessions'
import { SbUserId } from '../../common/users/sb-user-id'
import { useSelfUser } from '../auth/auth-utils'
import { ConnectedAvatar } from '../avatars/avatar'
import { MaterialIcon } from '../icons/material/material-icon'
import { HostCrown, RoomChip, SectionLabel } from '../lobbies/room/room-parts'
import { FilledButton, OutlinedButton, TextButton } from '../material/button'
import { Chat } from '../messaging/chat'
import { push } from '../navigation/routing'
import { isFetchError } from '../network/fetch-errors'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodyMedium, labelMedium, singleLine, titleLarge, titleMedium } from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'
import {
  closeReplaySession,
  declineReplaySessionInvite,
  inviteToReplaySession,
  joinReplaySession,
  leaveReplaySession,
  sendReplaySessionChat,
  startReplaySession,
} from './action-creators'
import {
  replaySessionAtom,
  replaySessionChatAtom,
  replaySessionInvitesAtom,
} from './replay-session-atoms'

const Root = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
`

const Header = styled.div`
  padding: 12px 16px;

  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;

  border-bottom: 1px solid var(--theme-outline-variant);
`

const Heading = styled.div`
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
`

const Title = styled.div`
  ${titleLarge};
  ${singleLine};
`

const Subtitle = styled.div`
  ${bodyMedium};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
`

const viewingChip = css`
  background-color: rgb(from var(--theme-positive) r g b / 0.16);
  color: var(--theme-positive);
`

const loadingChip = css`
  background-color: var(--theme-amber-container);
  color: var(--theme-on-amber-container);
`

const StateChip = styled(RoomChip)<{ $state: ReplaySessionJson['state'] }>`
  ${props => props.$state === 'viewing' && viewingChip};
  ${props => props.$state === 'loading' && loadingChip};
`

const Body = styled.div`
  min-height: 0;
  flex-grow: 1;
  display: flex;
`

const Rail = styled.div`
  width: 280px;
  flex-shrink: 0;
  padding: 16px 12px;

  display: flex;
  flex-direction: column;
  gap: 8px;

  border-right: 1px solid var(--theme-outline-variant);
  overflow-y: auto;
`

const ChatSurface = styled(Chat)`
  flex-grow: 1;
  min-width: 0;
  height: auto;
`

const Row = styled.div<{ $muted?: boolean }>`
  min-height: 48px;
  padding: 4px;

  display: flex;
  align-items: center;
  gap: 12px;

  border-radius: 8px;
  opacity: ${props => (props.$muted ? 0.6 : 1)};
`

const RowAvatar = styled(ConnectedAvatar)`
  width: 32px;
  height: 32px;
  flex-shrink: 0;
`

const RowName = styled.div`
  ${labelMedium};
  ${singleLine};
  min-width: 0;
  flex-grow: 1;

  display: flex;
  align-items: center;
  gap: 4px;
`

const RailSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;

  & + & {
    margin-top: 16px;
  }
`

const ReadinessPill = styled(m.div)<{ $ready: boolean }>`
  ${labelMedium};
  ${singleLine};
  padding: 2px 8px 2px 4px;
  flex-shrink: 0;

  display: flex;
  align-items: center;
  gap: 4px;

  border-radius: 999px;
  background-color: ${props =>
    props.$ready ? 'rgb(from var(--theme-positive) r g b / 0.16)' : 'var(--theme-container-high)'};
  color: ${props => (props.$ready ? 'var(--theme-positive)' : 'var(--theme-on-surface-variant)')};
`

/**
 * Shows whether a viewer has their replay loaded. Ready viewers light up as they arrive, so the
 * room can watch itself fill in while it waits to start.
 */
function Readiness({ loaded }: { loaded: boolean }) {
  const { t } = useTranslation()
  return (
    <AnimatePresence initial={false} mode='popLayout'>
      <ReadinessPill
        key={loaded ? 'ready' : 'loading'}
        $ready={loaded}
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.6, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 24 }}>
        <MaterialIcon icon={loaded ? 'check_circle' : 'downloading'} size={18} filled={loaded} />
        {loaded
          ? t('replaySessions.room.ready', 'Ready')
          : t('replaySessions.room.loading', 'Loading')}
      </ReadinessPill>
    </AnimatePresence>
  )
}

function MemberRow({
  session,
  member,
}: {
  session: ReplaySessionJson
  member: ReplaySessionMemberJson
}) {
  return (
    <Row>
      <RowAvatar userId={member.userId} />
      <RowName>
        <ConnectedUsername userId={member.userId} />
        {session.hostId === member.userId ? <HostCrown /> : null}
      </RowName>
      {session.state === 'loading' ? <Readiness loaded={member.loaded} /> : null}
    </Row>
  )
}

/** The host's list of friends who could still be invited to the session. */
function InviteFriends({ session }: { session: ReplaySessionJson }) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const friendIds = useAppSelector(s => Array.from(s.relationships.friends.keys()))
  const names = useAppSelector(s => s.users.byId)
  const [pendingId, setPendingId] = useState<SbUserId>()

  const present = new Set<SbUserId>([
    ...session.members.map(m => m.userId),
    ...session.invitedUserIds,
  ])
  const invitable = friendIds
    .filter(id => !present.has(id))
    .sort((a, b) => (names.get(a)?.name ?? '').localeCompare(names.get(b)?.name ?? ''))

  if (!invitable.length) {
    return null
  }

  return (
    <RailSection>
      <SectionLabel>{t('replaySessions.room.inviteFriends', 'Invite friends')}</SectionLabel>
      {invitable.map(userId => (
        <Row key={userId}>
          <RowAvatar userId={userId} />
          <RowName>
            <ConnectedUsername userId={userId} />
          </RowName>
          <TextButton
            label={t('replaySessions.room.invite', 'Invite')}
            disabled={pendingId === userId}
            onClick={() => {
              setPendingId(userId)
              dispatch(
                inviteToReplaySession(session.id, userId, {
                  onSuccess: () => setPendingId(undefined),
                  onError: err => {
                    setPendingId(undefined)
                    snackbarController.showSnackbar(
                      isFetchError(err) &&
                        err.code === ReplaySessionErrorCode.TargetCannotAccessReplay
                        ? t(
                            'replaySessions.room.inviteNoAccess',
                            "That user can't watch this game's replay.",
                          )
                        : t('replaySessions.room.inviteFailed', "Couldn't send the invite."),
                    )
                  },
                }),
              )
            }}
          />
        </Row>
      ))}
    </RailSection>
  )
}

function SessionRoom({ session }: { session: ReplaySessionJson }) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const selfUser = useSelfUser()
  const chat = useAtomValue(replaySessionChatAtom)
  const isHost = session.hostId === selfUser?.id
  const canInvite = isHost && session.state !== 'viewing'

  const { metadata } = session.source
  const notReady = session.members.filter(m => !m.loaded).length

  const onError = () =>
    snackbarController.showSnackbar(
      t('replaySessions.room.actionFailed', 'Something went wrong. Please try again.'),
    )
  const noop = () => {}

  let stateLabel: string
  switch (session.state) {
    case 'gathering':
      stateLabel = t('replaySessions.room.stateGathering', 'Gathering viewers')
      break
    case 'loading':
      stateLabel = t('replaySessions.room.stateLoading', {
        defaultValue_one: 'Waiting for {{count}} viewer',
        defaultValue_other: 'Waiting for {{count}} viewers',
        count: notReady,
      })
      break
    case 'viewing':
    case 'ended':
      stateLabel = t('replaySessions.room.stateViewing', 'Watching')
      break
  }

  return (
    <Root>
      <Header>
        <Heading>
          <MaterialIcon icon='smart_display' size={32} />
          <div>
            <Title>{metadata.mapName}</Title>
            <Subtitle>
              {t('replaySessions.room.subtitle', {
                defaultValue: '{{duration}} replay',
                duration: getGameDurationString(metadata.durationFrames * MS_PER_GAME_FRAME),
              })}
            </Subtitle>
          </div>
          <StateChip $state={session.state}>{stateLabel}</StateChip>
        </Heading>
        <HeaderActions>
          {isHost ? (
            <TextButton
              label={t('replaySessions.room.close', 'End session')}
              onClick={() => dispatch(closeReplaySession(session.id, { onSuccess: noop, onError }))}
            />
          ) : (
            <TextButton
              label={t('replaySessions.room.leave', 'Leave')}
              onClick={() => dispatch(leaveReplaySession(session.id, { onSuccess: noop, onError }))}
            />
          )}
          {isHost && session.state === 'gathering' ? (
            <FilledButton
              label={t('replaySessions.room.start', 'Start watching')}
              iconStart={<MaterialIcon icon='play_arrow' />}
              onClick={() => dispatch(startReplaySession(session.id, { onSuccess: noop, onError }))}
            />
          ) : null}
        </HeaderActions>
      </Header>
      <Body>
        <Rail>
          <RailSection>
            <SectionLabel>
              {t('replaySessions.room.viewers', {
                defaultValue: 'Viewers · {{count}}',
                count: session.members.length,
              })}
            </SectionLabel>
            {session.members.map(member => (
              <MemberRow key={member.userId} session={session} member={member} />
            ))}
          </RailSection>
          {session.invitedUserIds.length ? (
            <RailSection>
              <SectionLabel>{t('replaySessions.room.invited', 'Invited')}</SectionLabel>
              {session.invitedUserIds.map(userId => (
                <Row key={userId} $muted={true}>
                  <RowAvatar userId={userId} />
                  <RowName>
                    <ConnectedUsername userId={userId} />
                  </RowName>
                </Row>
              ))}
            </RailSection>
          ) : null}
          {canInvite ? <InviteFriends session={session} /> : null}
        </Rail>
        <ChatSurface
          listProps={{ messages: chat }}
          inputProps={{
            onSendChatMessage: text =>
              dispatch(sendReplaySessionChat(session.id, text, { onSuccess: noop, onError })),
            storageKey: `replay-session-${session.id}`,
          }}
          jumpToBottomOnSend
        />
      </Body>
    </Root>
  )
}

const CenteredArea = styled.div`
  width: 100%;
  height: 100%;
  padding: 16px;

  display: flex;
  align-items: center;
  justify-content: center;
`

const InviteCard = styled.div`
  width: 100%;
  max-width: 440px;
  padding: 24px;

  display: flex;
  flex-direction: column;
  gap: 16px;

  border-radius: 12px;
  background-color: var(--theme-container-low);
`

const InviteText = styled.div`
  ${titleMedium};
`

const InviteActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
`

function InvitePrompt({ invite }: { invite: ReplaySessionInviteJson }) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const [pending, setPending] = useState(false)

  return (
    <CenteredArea>
      <InviteCard>
        <InviteText>
          {t('replaySessions.invite.prompt', {
            defaultValue: 'You were invited to watch a replay on {{mapName}}.',
            mapName: invite.source.metadata.mapName,
          })}
        </InviteText>
        <Row>
          <RowAvatar userId={invite.hostId} />
          <RowName>
            <ConnectedUsername userId={invite.hostId} />
            <HostCrown />
          </RowName>
        </Row>
        <InviteActions>
          <TextButton
            label={t('replaySessions.invite.decline', 'Decline')}
            disabled={pending}
            onClick={() => {
              setPending(true)
              dispatch(
                declineReplaySessionInvite(invite.sessionId, {
                  onSuccess: () => push('/'),
                  onError: () => setPending(false),
                }),
              )
            }}
          />
          <FilledButton
            label={t('replaySessions.invite.join', 'Join')}
            disabled={pending}
            onClick={() => {
              setPending(true)
              dispatch(
                joinReplaySession(invite.sessionId, {
                  onSuccess: () => setPending(false),
                  onError: () => {
                    setPending(false)
                    snackbarController.showSnackbar(
                      t('replaySessions.invite.joinFailed', "Couldn't join that session."),
                    )
                  },
                }),
              )
            }}
          />
        </InviteActions>
      </InviteCard>
    </CenteredArea>
  )
}

export function ReplaySessionView({ params }: { params: { sessionId: string } }) {
  const { t } = useTranslation()
  const sessionId = makeSbReplaySessionId(params.sessionId)
  const session = useAtomValue(replaySessionAtom)
  const invite = useAtomValue(replaySessionInvitesAtom).find(i => i.sessionId === sessionId)

  if (session?.id === sessionId) {
    return <SessionRoom session={session} />
  } else if (invite) {
    return <InvitePrompt invite={invite} />
  }

  return (
    <CenteredArea>
      <InviteCard>
        <InviteText>
          {t('replaySessions.room.unavailable', "This replay session isn't available.")}
        </InviteText>
        <InviteActions>
          <OutlinedButton
            label={t('replaySessions.room.goHome', 'Go home')}
            onClick={() => push('/')}
          />
        </InviteActions>
      </InviteCard>
    </CenteredArea>
  )
}
