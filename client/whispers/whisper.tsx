import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user-id'
import { useSelfUser } from '../auth/auth-utils'
import { Chat } from '../messaging/chat'
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
  sendMessage,
  startWhisperSessionById,
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
  userId: SbUserId
  username?: string
}

export function ConnectedWhisper({ userId, username: usernameFromRoute }: ConnectedWhisperProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const selfUser = useSelfUser()!
  const targetUser = useAppSelector(s => s.users.byId.get(userId))
  const isSessionOpen = useAppSelector(s => s.whispers.sessions.has(userId))
  const whisperSession = useAppSelector(s => s.whispers.byId.get(userId))

  useEffect(() => {
    if (selfUser.id === userId) {
      snackbarController.showSnackbar(
        t('whispers.errors.cantWhisperYourself', "You can't whisper with yourself."),
      )
      replace('/')
    }

    if (targetUser && usernameFromRoute !== targetUser.name) {
      correctUsernameForWhisper(targetUser.id, targetUser.name)
    }
  }, [selfUser, userId, targetUser, usernameFromRoute, t, snackbarController])

  const prevIsSessionOpen = usePrevious(isSessionOpen)
  const prevUserId = usePrevious(userId)
  const isClosingWhisper = userId === prevUserId && prevIsSessionOpen && !isSessionOpen
  useEffect(() => {
    if (isClosingWhisper) {
      push('/')
    }
  }, [isClosingWhisper])

  useEffect(() => {
    if (isSessionOpen) {
      dispatch(activateWhisperSession(userId))
    } else if (!isClosingWhisper) {
      dispatch(
        startWhisperSessionById(userId, {
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
      dispatch(deactivateWhisperSession(userId))
    }
  }, [isSessionOpen, isClosingWhisper, userId, dispatch, t, snackbarController])

  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const onLoadMoreMessages = useStableCallback(() => {
    setIsLoadingHistory(true)
    dispatch(
      getMessageHistory(userId, MESSAGES_LIMIT, {
        onSuccess: () => {
          setIsLoadingHistory(false)
        },
        onError: err => {
          setIsLoadingHistory(false)
          // TODO(tec27): This would probably be better to show at the position the message loading
          // failed in the message list (and offer a button to retry)
          snackbarController.showSnackbar(
            t('whispers.errors.loadingHistory', {
              defaultValue: 'Error loading message history: {{errorMessage}}',
              errorMessage: err.message,
            }),
            DURATION_LONG,
          )
        },
      }),
    )
  })

  const onSendChatMessage = useStableCallback((msg: string) => {
    dispatch(
      sendMessage(userId, msg, {
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
          refreshToken: userId,
          onLoadMoreMessages,
        }}
        inputProps={{
          onSendChatMessage,
          storageKey: `whisper.${userId}`,
        }}
        extraContent={
          <UserInfoContainer>
            <UserProfileOverlayContents userId={userId} showHintText={false} />
          </UserInfoContainer>
        }
      />
    </Container>
  )
}
