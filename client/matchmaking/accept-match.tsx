import React, { useEffect } from 'react'
import styled from 'styled-components'
import { MATCHMAKING_ACCEPT_MATCH_TIME_MS } from '../../common/matchmaking'
import { range } from '../../common/range'
import { Avatar } from '../avatars/avatar'
import { closeDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { DialogType } from '../dialogs/dialog-type'
import { useKeyListener } from '../keyboard/key-listener'
import { RaisedButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useStableCallback } from '../state-hooks'
import { amberA400 } from '../styles/colors'
import { Body1 } from '../styles/typography'
import { acceptMatch } from './action-creators'
import { useTranslation } from 'react-i18next'

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

const AcceptMatchButton = styled(RaisedButton)`
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
  background-color: rgba(255, 255, 255, 0.16);
`

const FilledTimerBar = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 8px;
  background-color: ${amberA400};
  transform: scaleX(var(--sb-timer-scale-x, 0));
  transform-origin: 0% 50%;
  transition: transform 1000ms linear;
  will-change: transform;
`

export default function AcceptMatch({ dialogRef }: CommonDialogProps) {
  const dispatch = useAppDispatch()
  const { t } = useTranslation()
  const searchInfo = useAppSelector(s => s.matchmaking.searchInfo)
  const failedToAccept = useAppSelector(s => s.matchmaking.failedToAccept)
  const match = useAppSelector(s => s.matchmaking.match)

  useEffect(() => {
    if (!searchInfo && !failedToAccept && !match) {
      dispatch(closeDialog(DialogType.AcceptMatch))
    }
  }, [dispatch, searchInfo, failedToAccept, match])

  let contents: React.ReactNode | undefined
  if (searchInfo && !match) {
    contents = (
      <p>
        {t('matchmaking.acceptMatch.failedToAcceptText', 'Some players didn\'t ready up in time or failed to load. Returning to the matchmaking queue\u2026')}
      </p>
    )
  } else if (failedToAccept) {
    contents = <FailedStateView />
  } else if (!match) {
    // In this case, the dialog is about to close anyway
    contents = undefined
  } else {
    contents = <AcceptingStateView />
  }

  const title = failedToAccept ? 'Failed to accept' : 'Match found'
  return (
    <StyledDialog title={title} showCloseButton={false} dialogRef={dialogRef}>
      {contents}
    </StyledDialog>
  )
}

function AcceptingStateView() {
  const dispatch = useAppDispatch()
  const isAccepting = useAppSelector(s => s.matchmaking.isAccepting)
  const hasAccepted = useAppSelector(s => s.matchmaking.hasAccepted)
  const match = useAppSelector(s => s.matchmaking.match)
  const acceptTime = useAppSelector(s => s.matchmaking.acceptTime ?? 0)
  const { t } = useTranslation()
  const onAcceptClick = useStableCallback(() => {
    dispatch(acceptMatch())
  })
  useKeyListener({
    onKeyDown: (event: KeyboardEvent) => {
      if (event.code === ENTER || event.code === ENTER_NUMPAD) {
        onAcceptClick()
        return true
      }

      return false
    },
  })

  // TODO(2Pac): Display actual user's avatars for themselves / their party members, while
  // leaving the default avatar for opponents (though maybe it's fine to show opponents too at
  // this point?).
  const acceptedAvatars = Array.from(range(0, match?.acceptedPlayers ?? 0), i => (
    <StyledAvatar key={i} color={amberA400} glowing={true} />
  ))
  const unacceptedAvatars = Array.from(
    range(match?.acceptedPlayers ?? 0, match?.numPlayers ?? 0),
    i => <StyledAvatar key={i} />,
  )

  return (
    <div>
      <Body1>{t('matchmaking.acceptMatch.waitingToAccept', 'All players must ready up for the match to start.')}</Body1>
      <CenteredContainer>
        {hasAccepted ? (
          [...acceptedAvatars, ...unacceptedAvatars]
        ) : (
          <AcceptMatchButton label={t('matchmaking.acceptMatch.readyUpLabel', 'Ready up')} onClick={onAcceptClick} disabled={isAccepting} />
        )}
      </CenteredContainer>
      <TimerBarContainer>
        <FilledTimerBar
          style={
            {
              '--sb-timer-scale-x': (acceptTime / MATCHMAKING_ACCEPT_MATCH_TIME_MS) * 1000,
            } as any
          }
        />
      </TimerBarContainer>
    </div>
  )
}

function FailedStateView() {
  const dispatch = useAppDispatch()
  const { t } = useTranslation()
  const onFailedClick = useStableCallback(() => {
    dispatch(closeDialog(DialogType.AcceptMatch))
  })
  useKeyListener({
    onKeyDown: (event: KeyboardEvent) => {
      if (event.code === ENTER || event.code === ENTER_NUMPAD) {
        onFailedClick()
        return true
      }

      return false
    },
  })

  return (
    <div>
      <p>{t('matchmaking.acceptMatch.failedToAcceptText', 'You didn\'t ready up in time and have been removed from the queue.')}</p>
      <RaisedButton label={t('matchmaking.acceptMatch.okButtonText', 'Ok')} onClick={onFailedClick} />
    </div>
  )
}
