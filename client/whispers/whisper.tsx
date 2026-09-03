import { useEffect, useEffectEvent, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user-id'
import { WhisperServiceErrorCode } from '../../common/whispers'
import { useSelfUser } from '../auth/auth-utils'
import { useWindowFocus } from '../dom/window-focus'
import { Chat } from '../messaging/chat'
import { anchorNeedsFetch, chatViewAnchorStore } from '../messaging/chat-view-anchor'
import { flushLastRead } from '../messaging/last-read'
import { MESSAGE_LINK_PARAM } from '../messaging/message-link'
import { isServerOriginMessage } from '../messaging/message-records'
import { useLocationSearchParam } from '../navigation/router-hooks'
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
  getMessagesAroundMessage,
  getNewerMessages,
  getWhisperLastReadKey,
  jumpToPresent,
  markWhisperRead,
  resetMessageWindow,
  sendMessage,
  startWhisperSessionById,
  updateSessionAtBottom,
} from './action-creators'
import { WhisperMessageMenu } from './whisper-menu-items'

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
  const isWindowFocused = useWindowFocus()
  // A message named by a link the user followed here. It's consumed rather than kept: once the list
  // has acted on it the param goes away, so reloading the page afterwards is an ordinary visit.
  const [linkedMessageId, setLinkedMessageId] = useLocationSearchParam(MESSAGE_LINK_PARAM)

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

    if (linkedMessageId) {
      // A link names the window this activation needs, which the effect below requests. The
      // position the user left behind is where they were, not where they just asked to go.
      return
    }

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

  const onLinkedMessage = useEffectEvent((messageId: string, signal: AbortSignal) => {
    // The window that's loaded doesn't hold the message; the request below replaces it with one that
    // does, showing the current messages under a loading indicator until it lands. The window isn't
    // dropped up front: an abandoned request (the user leaving, or a development remount) would
    // otherwise leave it empty with nothing to refill it.
    dispatch(
      getMessagesAroundMessage(targetId, MESSAGES_LIMIT, messageId, {
        signal,
        onSuccess: () => {},
        onError: err => {
          if (isFetchError(err) && err.code === WhisperServiceErrorCode.MessageNotFound) {
            snackbarController.showSnackbar(
              t(
                'whispers.errors.messageNotFound',
                "That message couldn't be found. It may have been deleted.",
              ),
              DURATION_LONG,
            )
          } else {
            showMessageLoadError(err)
          }

          // The window was dropped to make room for one that can't be had, so the conversation goes
          // back to the newest messages rather than being left empty.
          setLinkedMessageId('')
          dispatch(
            jumpToPresent(targetId, MESSAGES_LIMIT, {
              onSuccess: () => {},
              onError: showMessageLoadError,
            }),
          )
        },
      }),
    )
  })

  // Holds the request for the window a linked message sits in, so it's made once for a given link
  // and abandoned only when the link or conversation changes — not on the message updates that
  // settling the session's own window brings.
  const linkFetchRef = useRef<AbortController | undefined>(undefined)
  useEffect(() => {
    return () => {
      linkFetchRef.current?.abort()
      linkFetchRef.current = undefined
    }
  }, [targetId, linkedMessageId])

  // A link into a whisper is reached by loading the window its message sits in, but only once the
  // session's own window has settled. A message already loaded there is placed by the list with no
  // fetch at all; a fetch made before the entry even exists, or against the empty window a session
  // starts with, would either be dropped or race the session's initial load. So this waits for the
  // window to hold messages (or to have run out of history) and to be idle, then loads around the
  // message if it isn't already on screen. The reading position the user left behind gives way to
  // it: a link names where they just asked to go.
  useEffect(() => {
    if (!isSessionOpen || !linkedMessageId || !whisperSession || linkFetchRef.current) {
      return
    }
    if (whisperSession.messages.some(m => m.id === linkedMessageId)) {
      return
    }
    if (whisperSession.loadingHistory) {
      return
    }
    if (whisperSession.messages.length === 0 && whisperSession.hasHistory) {
      return
    }

    const abortController = new AbortController()
    linkFetchRef.current = abortController
    onLinkedMessage(linkedMessageId, abortController.signal)
  }, [isSessionOpen, targetId, linkedMessageId, whisperSession])

  const onLinkedMessageSettled = () => {
    // However the move came out, the link has been acted on and shouldn't move the list again.
    setLinkedMessageId('')
  }

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

  // Reports the read position whenever the session is open, scrolled to the bottom, and the app
  // window is focused, so arriving at a session already at the bottom (or scrolling back down to
  // it) reports the newest message just as much as a message arriving while already there does.
  // The read position never advances while the window is unfocused: messages landing in a session
  // that's open and at the bottom while the user is off in another window stay unread until they
  // come back, at which point this re-runs and reports the newest one. Refocusing with nothing new
  // to report costs no request — the coalescer drops a position it has already sent.
  useEffect(() => {
    if (
      whisperSession?.activated &&
      whisperSession.atBottom &&
      isWindowFocused &&
      newestMessageTime !== undefined
    ) {
      dispatch(markWhisperRead(targetId, newestMessageTime))
    }
  }, [
    whisperSession?.activated,
    whisperSession?.atBottom,
    isWindowFocused,
    newestMessageTime,
    targetId,
    dispatch,
  ])

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
          snackbarController.showSnackbar(
            t('whispers.errors.sendingMessage', {
              defaultValue: 'Error sending message: {{errorMessage}}',
              errorMessage: err.message,
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
        linkedMessageId={linkedMessageId || undefined}
        onLinkedMessageSettled={onLinkedMessageSettled}
        onAtBottomChange={onAtBottomChange}
        onJumpToPresent={onJumpToPresent}
        onSeekToUnread={onSeekToUnread}
        extraContent={
          <UserInfoContainer>
            <UserProfileOverlayContents userId={targetId} showHintText={false} />
          </UserInfoContainer>
        }
        MessageMenu={WhisperMessageMenu}
      />
    </Container>
  )
}
