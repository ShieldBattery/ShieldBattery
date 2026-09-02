import { useEffect, useEffectEvent } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user-id'
import { isWhisperServiceErrorCode, whisperServiceErrorToString } from '../../common/whispers'
import { useSelfUser } from '../auth/auth-utils'
import { Chat } from '../messaging/chat'
import { anchorNeedsFetch, chatViewAnchorStore } from '../messaging/chat-view-anchor'
import { flushLastRead } from '../messaging/last-read'
import { isServerOriginMessage } from '../messaging/message-records'
import { push, replace } from '../navigation/routing'
import { isFetchError } from '../network/fetch-errors'
import LoadingIndicator from '../progress/dots'
import { usePrevious, useStableCallback } from '../react/state-hooks'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { DURATION_LONG } from '../snackbars/snackbar-durations'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { CenteredContentContainer } from '../styles/centered-container'
import { UserProfileOverlayContents } from '../users/user-profile-overlay'
import {
  activateWhisperSession,
  correctUsernameForWhisper,
  deactivateWhisperSession,
  getMessageHistory,
  getMessagesAround,
  getNewerMessages,
  getWhisperLastReadKey,
  jumpToPresent,
  markWhisperRead,
  resetMessageWindow,
  sendMessage,
  startWhisperSessionById,
  updateSessionAtBottom,
} from './action-creators'

const MESSAGES_LIMIT = 50

const Container = styled(CenteredContentContainer).attrs({ $targetHorizontalPadding: 16 })`
  display: flex;
  padding-top: 8px;
  gap: 8px;
`

const StyledChat = styled(Chat)`
  flex-grow: 1;
`

const LoadingArea = styled.div`
  padding-top: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
`

const UserInfoContainer = styled.div`
  flex-shrink: 0;
  width: 280px;
  height: calc(100% - 8px);
  margin-bottom: 8px;

  contain: content;

  background: var(--theme-container-low);
  border-radius: 8px;
  overflow-y: auto;
  overflow-x: hidden;
`

export interface ConnectedWhisperProps {
  targetId: SbUserId
  targetUsername?: string
}

export function ConnectedWhisper({
  targetId,
  targetUsername: targetUsernameFromRoute,
}: ConnectedWhisperProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const selfUser = useSelfUser()!
  const targetUser = useAppSelector(s => s.users.byId.get(targetId))
  const isSessionOpen = useAppSelector(s => s.whispers.sessions.has(targetId))
  const whisperSession = useAppSelector(s => s.whispers.byId.get(targetId))

  useEffect(() => {
    if (selfUser.id === targetId) {
      snackbarController.showSnackbar(
        t('whispers.errors.cantWhisperYourself', "You can't whisper with yourself."),
      )
      replace('/')
    }

    if (targetUser && targetUsernameFromRoute !== targetUser.name) {
      correctUsernameForWhisper(targetUser.id, targetUser.name)
    }
  }, [selfUser, targetId, targetUser, targetUsernameFromRoute, t, snackbarController])

  const prevIsSessionOpen = usePrevious(isSessionOpen)
  const prevTargetId = usePrevious(targetId)
  const isClosingWhisper = targetId === prevTargetId && prevIsSessionOpen && !isSessionOpen
  useEffect(() => {
    if (isClosingWhisper) {
      push('/')
    }
  }, [isClosingWhisper])

  const showMessageLoadError = (err: Error) => {
    // TODO(tec27): This would probably be better to show at the position the message loading
    // failed in the message list (and offer a button to retry)
    snackbarController.showSnackbar(
      t('whispers.errors.loadingHistory', {
        defaultValue: 'Error loading message history: {{errorMessage}}',
        errorMessage: err.message,
      }),
      DURATION_LONG,
    )
  }

  const viewStateKey = `whisper.${targetId}`

  const onActivate = useEffectEvent(() => {
    const anchor = chatViewAnchorStore.get(viewStateKey)
    dispatch(activateWhisperSession(targetId))

    if (anchor && anchorNeedsFetch(whisperSession?.messages ?? [], anchor)) {
      // Getting back to where the user was reading takes a window the client doesn't hold, so that
      // window is this activation's history request instead of the newest page the list would
      // otherwise ask for. Whatever window is still loaded doesn't contain the position either and
      // is about to be replaced anyway, so it's dropped up front rather than left on screen: leaving
      // it in place would show the user a spot they weren't (its bottom) only to yank them away once
      // the requested window lands, whereas an empty window renders as loading for that same wait.
      dispatch(resetMessageWindow(targetId))
      dispatch(
        getMessagesAround(targetId, MESSAGES_LIMIT, anchor.sentTime, {
          onSuccess: () => {},
          onError: showMessageLoadError,
        }),
      )
    }
  })

  // Opens a session for the whisper target. A session that has gone away because the user closed
  // this whisper is left closed: closing navigates away from the whisper rather than reopening it.
  const onOpenSession = useEffectEvent(() => {
    if (isClosingWhisper) {
      return
    }

    dispatch(
      startWhisperSessionById(targetId, {
        onSuccess: () => {},
        onError: err => {
          snackbarController.showSnackbar(
            t('whispers.errors.openSession', {
              defaultValue: 'Error opening whisper to user: {{errorMessage}}',
              errorMessage: err.message,
            }),
            DURATION_LONG,
          )
          push('/')
        },
      }),
    )
  })

  useEffect(() => {
    if (isSessionOpen) {
      onActivate()
    } else {
      onOpenSession()
    }

    return () => {
      dispatch(deactivateWhisperSession(targetId))
    }
  }, [isSessionOpen, targetId, dispatch])

  // The newest server-recorded message time: only server-origin messages carry one, and a read
  // position must never be reported from a locally-stamped time.
  let newestMessageTime: number | undefined
  if (whisperSession) {
    for (let i = whisperSession.messages.length - 1; i >= 0; i--) {
      const message = whisperSession.messages[i]
      if (isServerOriginMessage(message)) {
        newestMessageTime = message.time
        break
      }
    }
  }

  // Reports the read position whenever the session is both open and scrolled to the bottom, so
  // arriving at a session already at the bottom (or scrolling back down to it) reports the newest
  // message just as much as a message arriving while already there does.
  useEffect(() => {
    if (whisperSession?.activated && whisperSession.atBottom && newestMessageTime !== undefined) {
      dispatch(markWhisperRead(targetId, newestMessageTime))
    }
  }, [whisperSession?.activated, whisperSession?.atBottom, newestMessageTime, targetId, dispatch])

  useEffect(() => () => flushLastRead(getWhisperLastReadKey(targetId)), [targetId])

  const unreadLineTime = whisperSession?.unreadLineTime

  const onLoadMoreMessages = useStableCallback(() => {
    dispatch(
      getMessageHistory(targetId, MESSAGES_LIMIT, {
        onSuccess: () => {},
        onError: showMessageLoadError,
      }),
    )
  })

  const onLoadNewerMessages = useStableCallback(() => {
    dispatch(
      getNewerMessages(targetId, MESSAGES_LIMIT, {
        onSuccess: () => {},
        onError: showMessageLoadError,
      }),
    )
  })

  const onJumpToPresent = () => {
    dispatch(
      jumpToPresent(targetId, MESSAGES_LIMIT, {
        onSuccess: () => {},
        onError: showMessageLoadError,
      }),
    )
  }

  const onSeekToUnread = () => {
    if (unreadLineTime === undefined) {
      return
    }

    dispatch(
      getMessagesAround(targetId, MESSAGES_LIMIT, unreadLineTime, {
        onSuccess: () => {},
        onError: showMessageLoadError,
      }),
    )
  }

  const onAtBottomChange = (atBottom: boolean) => {
    dispatch(updateSessionAtBottom(targetId, atBottom))
  }

  const onSendChatMessage = useStableCallback((msg: string) => {
    dispatch(
      sendMessage(targetId, msg, {
        onSuccess: () => {},
        onError: err => {
          // TODO(tec27): Offer a retry for the same message content? Display it in the message list
          // ala Discord?
          const errorMessage =
            isFetchError(err) && isWhisperServiceErrorCode(err.code ?? '')
              ? whisperServiceErrorToString(err.code, t)
              : err.message
          snackbarController.showSnackbar(
            t('whispers.errors.sendingMessage', {
              defaultValue: 'Error sending message: {{errorMessage}}',
              errorMessage,
            }),
            DURATION_LONG,
          )
        },
      }),
    )
  })

  if (!whisperSession) {
    return (
      <LoadingArea>
        <LoadingIndicator />
      </LoadingArea>
    )
  }

  return (
    <Container>
      <StyledChat
        listProps={{
          messages: whisperSession.messages,
          loading: whisperSession.loadingHistory,
          hasMoreHistory: whisperSession.hasHistory,
          loadingNewer: whisperSession.loadingNewer,
          hasNewerMessages: whisperSession.hasNewer,
          windowGeneration: whisperSession.windowGen,
          refreshToken: targetId,
          viewStateKey,
          onLoadMoreMessages,
          onLoadNewerMessages,
          unreadLineTime,
        }}
        inputProps={{
          onSendChatMessage,
          storageKey: viewStateKey,
        }}
        onAtBottomChange={onAtBottomChange}
        onJumpToPresent={onJumpToPresent}
        onSeekToUnread={onSeekToUnread}
        extraContent={
          <UserInfoContainer>
            <UserProfileOverlayContents userId={targetId} showHintText={false} />
          </UserInfoContainer>
        }
      />
    </Container>
  )
}
