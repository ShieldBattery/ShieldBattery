import { useAtomValue, useStore } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getErrorStack } from '../../common/errors'
import {
  MATCHMAKING_ACCEPT_MATCH_TIME_MS,
  MatchmakingServiceErrorCode,
} from '../../common/matchmaking'
import { range } from '../../common/range'
import { Avatar } from '../avatars/avatar'
import { closeDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { DialogType } from '../dialogs/dialog-type'
import { useKeyListener } from '../keyboard/key-listener'
import logger from '../logging/logger'
import { FilledButton, TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { isFetchError } from '../network/fetch-errors'
import { useAppDispatch } from '../redux-hooks'
import { BodyMedium } from '../styles/typography'
import { acceptMatch } from './action-creators'
import {
  clearMatchmakingState,
  currentSearchInfoAtom,
  foundMatchAtom,
  hasAcceptedAtom,
} from './matchmaking-atoms'

const ENTER = 'Enter'
const ENTER_NUMPAD = 'NumpadEnter'

const StyledDialog = styled(Dialog)`
  width: 400px;
`

const CenteredContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  margin: 32px 0;
`

const AcceptMatchButton = styled(FilledButton)`
  width: 162px;
`

const StyledAvatar = styled(Avatar)`
  &:not(:first-child) {
    margin-left: 8px;
  }
`

const TimerBarContainer = styled.div`
  position: relative;
  width: 100%;
  height: 8px;
  background-color: var(--theme-container-highest);
`

const FilledTimerBar = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 8px;
  background-color: var(--theme-amber);
  transform: scaleX(var(--sb-timer-scale-x, 0));
  transform-origin: 0% 50%;
  transition: transform 1000ms linear;
  will-change: transform;
`

export function AcceptMatchDialog({ onCancel }: CommonDialogProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const currentSearchInfo = useAtomValue(currentSearchInfoAtom)
  const foundMatch = useAtomValue(foundMatchAtom)

  useEffect(() => {
    if (!currentSearchInfo && !foundMatch) {
      dispatch(closeDialog(DialogType.AcceptMatch))
    } else if (currentSearchInfo && !foundMatch) {
      const timeout = setTimeout(() => {
        dispatch(closeDialog(DialogType.AcceptMatch))
      }, 5000)

      return () => {
        clearTimeout(timeout)
      }
    }

    return () => {}
  }, [dispatch, currentSearchInfo, foundMatch])

  let contents: React.ReactNode | undefined
  if (currentSearchInfo && !foundMatch) {
    contents = (
      <p>
        {t(
          'matchmaking.acceptMatch.returningToQueue',
          "Some players didn't ready up in time or failed to load. Returning to the matchmaking " +
            'queue…',
        )}
      </p>
    )
  } else if (!foundMatch) {
    // In this case, the dialog is about to close anyway
    contents = undefined
  } else {
    contents = <AcceptingStateView />
  }

  return (
    <StyledDialog
      title={t('matchmaking.acceptMatch.matchFound', 'Match found')}
      onCancel={onCancel}
      showCloseButton={false}>
      {contents}
    </StyledDialog>
  )
}

function AcceptingStateView() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const store = useStore()
  const hasAccepted = useAtomValue(hasAcceptedAtom)
  const foundMatch = useAtomValue(foundMatchAtom)

  const acceptStart = foundMatch?.acceptStart ?? window.performance.now()
  const [secondsLeft, setSecondsLeft] = useState(() => {
    const elapsed = (window.performance.now() - acceptStart) / 1000
    return Math.max(Math.ceil(MATCHMAKING_ACCEPT_MATCH_TIME_MS / 1000 - elapsed), 0)
  })

  const acceptButtonRef = useRef<HTMLButtonElement>(null)
  const retries = useRef(0)
  const [acceptInProgress, setAcceptInProgress] = useState(false)

  useEffect(() => {
    const update = () => {
      const elapsed = (window.performance.now() - acceptStart) / 1000
      setSecondsLeft(Math.max(Math.ceil(MATCHMAKING_ACCEPT_MATCH_TIME_MS / 1000 - elapsed), 0))
    }

    const interval = setInterval(() => {
      update()
    }, 1000)

    update()

    return () => clearInterval(interval)
  }, [acceptStart])

  useKeyListener({
    onKeyDown: (event: KeyboardEvent) => {
      if (event.code === ENTER || event.code === ENTER_NUMPAD) {
        acceptButtonRef.current?.click()
        return true
      }

      return false
    },
  })

  const acceptedAvatars = Array.from(range(0, foundMatch?.acceptedPlayers ?? 0), i => (
    <StyledAvatar key={i} color={'var(--theme-amber)'} glowing={true} />
  ))
  const unacceptedAvatars = Array.from(
    range(foundMatch?.acceptedPlayers ?? 0, foundMatch?.numPlayers ?? 0),
    i => <StyledAvatar key={i} />,
  )

  return (
    <div>
      <BodyMedium>
        {t('matchmaking.acceptMatch.body', 'All players must ready up for the match to start.')}
      </BodyMedium>
      <CenteredContainer>
        {hasAccepted ? (
          [...acceptedAvatars, ...unacceptedAvatars]
        ) : (
          <AcceptMatchButton
            ref={acceptButtonRef}
            label={t('matchmaking.acceptMatch.readyUp', 'Ready up')}
            onClick={() =>
              dispatch(
                acceptMatch({
                  onSuccess: () => {
                    setAcceptInProgress(false)
                  },
                  onError: err => {
                    if (
                      isFetchError(err) &&
                      err.code === MatchmakingServiceErrorCode.NoActiveMatch
                    ) {
                      logger.error('Accepting match failed, no active match: ' + getErrorStack(err))
                      clearMatchmakingState(store)
                      dispatch(closeDialog(DialogType.AcceptMatch))
                    } else {
                      logger.error(`Accepting match failed: ${getErrorStack(err)}`)
                      setAcceptInProgress(false)
                      setTimeout(() => {
                        if (retries.current < 10) {
                          retries.current++
                          // Retry the accept after we let the button un-disable, since the user
                          // almost certainly wants to and may not have much time to react to an
                          // error
                          acceptButtonRef.current?.click()
                        }
                      }, 400)
                    }
                  },
                }),
              )
            }
            disabled={acceptInProgress}
          />
        )}
      </CenteredContainer>
      <TimerBarContainer>
        <FilledTimerBar
          style={
            {
              '--sb-timer-scale-x': (secondsLeft / MATCHMAKING_ACCEPT_MATCH_TIME_MS) * 1000,
            } as any
          }
        />
      </TimerBarContainer>
    </div>
  )
}

export function FailedToAcceptMatchDialog({ onCancel }: CommonDialogProps) {
  const { t } = useTranslation()

  useKeyListener({
    onKeyDown: (event: KeyboardEvent) => {
      if (event.code === ENTER || event.code === ENTER_NUMPAD) {
        onCancel()
        return true
      }

      return false
    },
  })

  return (
    <StyledDialog
      title={t('matchmaking.acceptMatch.failedToAccept', 'Failed to accept')}
      onCancel={onCancel}
      showCloseButton={true}
      buttons={[
        <TextButton key='ok' label={t('common.actions.okay', 'Okay')} onClick={onCancel} />,
      ]}>
      <p>
        {t(
          'matchmaking.acceptMatch.removedFromQueue',
          "You didn't ready up in time and have been removed from the queue.",
        )}
      </p>
    </StyledDialog>
  )
}
