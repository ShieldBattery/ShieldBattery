import { useEffect, useEffectEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user-id'
import { useSelfUser } from '../auth/auth-utils'
import { Chat } from '../messaging/chat'
import { anchorNeedsFetch, chatViewAnchorStore } from '../messaging/chat-view-anchor'
import { flushLastRead } from '../messaging/last-read'
import { isServerOriginMessage } from '../messaging/message-records'
import { push, replace } from '../navigation/routing'
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

  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [isLoadingNewer, setIsLoadingNewer] = useState(false)

  const viewStateKey = `whisper.${targetId}`

  const onActivate = useEffectEvent(() => {
    const anchor = chatViewAnchorStore.get(viewStateKey)
    dispatch(activateWhisperSession(targetId, anchor === undefined))

    if (anchor && anchorNeedsFetch(whisperSession?.messages ?? [], anchor)) {
      // Getting back to where the user was reading takes a window the client doesn't hold, so that
      // window is this activation's history request instead of the newest page the list would
      // otherwise ask for.
      dispatch(
        getMessagesAround(targetId, MESSAGES_LIMIT, anchor.sentTime, {
          onStart: () => {
            setIsLoadingHistory(true)
          },
          onSuccess: () => {
            setIsLoadingHistory(false)
          },
          onError: err => {
            setIsLoadingHistory(false)
            showMessageLoadError(err)
          },
        }),
      )
    }
  })

  useEffect(() => {
    if (isSessionOpen) {
      onActivate()
    } else if (!isClosingWhisper) {
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
    }

    return () => {
      dispatch(deactivateWhisperSession(targetId))
    }
  }, [isSessionOpen, isClosingWhisper, targetId, dispatch, t, snackbarController])

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
    setIsLoadingHistory(true)
    dispatch(
      getMessageHistory(targetId, MESSAGES_LIMIT, {
        onSuccess: () => {
          setIsLoadingHistory(false)
        },
        onError: err => {
          setIsLoadingHistory(false)
          showMessageLoadError(err)
        },
      }),
    )
  })

  const onLoadNewerMessages = () => {
    setIsLoadingNewer(true)
    dispatch(
      getNewerMessages(targetId, MESSAGES_LIMIT, {
        onSuccess: () => {
          setIsLoadingNewer(false)
        },
        onError: err => {
          setIsLoadingNewer(false)
          showMessageLoadError(err)
        },
      }),
    )
  }

  const onJumpToPresent = () => {
    setIsLoadingHistory(true)
    dispatch(
      jumpToPresent(targetId, MESSAGES_LIMIT, {
        onSuccess: () => {
          setIsLoadingHistory(false)
        },
        onError: err => {
          setIsLoadingHistory(false)
          showMessageLoadError(err)
        },
      }),
    )
  }

  const onSeekToUnread = () => {
    if (unreadLineTime === undefined) {
      return
    }

    // The whole window is about to be replaced, so there's no one edge the wait belongs to; the
    // older edge's affordance stands in for both.
    setIsLoadingHistory(true)
    dispatch(
      getMessagesAround(targetId, MESSAGES_LIMIT, unreadLineTime, {
        onSuccess: () => {
          setIsLoadingHistory(false)
        },
        onError: err => {
          setIsLoadingHistory(false)
          showMessageLoadError(err)
        },
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
          loading: isLoadingHistory,
          hasMoreHistory: whisperSession.hasHistory,
          loadingNewer: isLoadingNewer,
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
