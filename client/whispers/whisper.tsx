import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user'
import { useSelfUser } from '../auth/state-hooks'
import { Chat } from '../messaging/chat'
import { push, replace } from '../navigation/routing'
import LoadingIndicator from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { openSnackbar, TIMING_LONG } from '../snackbars/action-creators'
import { usePrevious, useStableCallback } from '../state-hooks'
import {
  activateWhisperSession,
  correctUsernameForWhisper,
  deactivateWhisperSession,
  getMessageHistory,
  sendMessage,
  startWhisperSessionById,
} from './action-creators'

const MESSAGES_LIMIT = 50

const Container = styled.div`
  max-width: 884px;
  height: 100%;
  padding: 0;
`

const LoadingArea = styled.div`
  padding-top: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
`

export interface ConnectedWhisperProps {
  userId: SbUserId
  username?: string
}

export function ConnectedWhisper({ userId, username: usernameFromRoute }: ConnectedWhisperProps) {
  const dispatch = useAppDispatch()
  const selfUser = useSelfUser()
  const targetUser = useAppSelector(s => s.users.byId.get(userId))
  const isSessionOpen = useAppSelector(s => s.whispers.sessions.has(userId))
  const whisperSession = useAppSelector(s => s.whispers.byId.get(userId))

  useEffect(() => {
    if (selfUser && selfUser.id === userId) {
      dispatch(openSnackbar({ message: "You can't whisper with yourself." }))
      replace('/')
    }

    if (targetUser && usernameFromRoute !== targetUser.name) {
      correctUsernameForWhisper(targetUser.id, targetUser.name)
    }
  }, [selfUser, userId, targetUser, usernameFromRoute, dispatch])

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
            dispatch(
              openSnackbar({
                message: `Error opening whisper to user: ${err.message}`,
                time: TIMING_LONG,
              }),
            )
            push('/')
          },
        }),
      )
    }

    return () => {
      dispatch(deactivateWhisperSession(userId))
    }
  }, [isSessionOpen, isClosingWhisper, userId, dispatch])

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
          dispatch(
            openSnackbar({
              message: `Error loading message history: ${err.message}`,
              time: TIMING_LONG,
            }),
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
          dispatch(
            openSnackbar({
              message: `Error sending message: ${err.message}`,
              time: TIMING_LONG,
            }),
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

  const listProps = {
    messages: whisperSession.messages,
    loading: isLoadingHistory,
    hasMoreHistory: whisperSession.hasHistory,
    refreshToken: userId,
    onLoadMoreMessages,
  }
  const inputProps = {
    onSendChatMessage,
    storageKey: `whisper.${userId}`,
  }

  return (
    <Container>
      <Chat listProps={listProps} inputProps={inputProps} />
    </Container>
  )
}
