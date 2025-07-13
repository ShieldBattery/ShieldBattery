import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getErrorStack } from '../../common/errors'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { logger } from '../logging/logger'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { useAppDispatch } from '../redux-hooks'
import { BodyLarge, titleLarge } from '../styles/typography'
import { getMatchmakingBanStatus } from './action-creators'

const StyledDialog = styled(Dialog)`
  width: 480px;
`

const Content = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const DurationText = styled.div`
  ${titleLarge};

  margin-top: 16px;
  text-align: center;
`

const ONE_MINUTE = 60 * 1000
const ONE_HOUR = 60 * ONE_MINUTE
const ONE_DAY = 24 * ONE_HOUR

// TODO(tec27): Once this is in the typings, remove the any cast
const durationFormat = new (Intl as any).DurationFormat(navigator.language, { style: 'narrow' })

export function MatchmakingBannedDialog({ onCancel }: CommonDialogProps) {
  const dispatch = useAppDispatch()
  const { t } = useTranslation()

  const [bannedUntil, setBannedUntil] = useState<number>()
  const [bannedUntilStr, setBannedUntilStr] = useState<string>('')

  useEffect(() => {
    const abortController = new AbortController()
    dispatch(
      getMatchmakingBanStatus({
        signal: abortController.signal,
        onSuccess: response => {
          setBannedUntil(response.bannedUntil)
        },
        onError: error => {
          logger.error('Failed to fetch matchmaking ban status: ' + getErrorStack(error))
        },
      }),
    )
    return () => {
      abortController.abort()
    }
  }, [dispatch])

  useEffect(() => {
    if (!bannedUntil) {
      return () => {}
    }

    function updateString() {
      const diff = bannedUntil! - Date.now()
      if (diff <= 0) {
        onCancel()
        return
      }

      const days = Math.floor(diff / ONE_DAY)
      const hours = Math.floor((diff % ONE_DAY) / ONE_HOUR)
      const minutes = Math.floor((diff % ONE_HOUR) / ONE_MINUTE)
      const seconds = Math.floor((diff % ONE_MINUTE) / 1000)

      // TODO(tec27): Once this API is in the typings, give this a proper type
      let duration: any
      if (days > 0) {
        duration = { days, hours, minutes, seconds }
      } else if (hours > 0) {
        duration = { hours, minutes, seconds }
      } else if (minutes > 0) {
        duration = { minutes, seconds }
      } else {
        duration = { seconds }
      }

      setBannedUntilStr(durationFormat.format(duration))
    }

    updateString()
    const timer = setInterval(updateString, 1000)
    return () => {
      clearInterval(timer)
    }
  }, [bannedUntil, onCancel])

  return (
    <StyledDialog
      onCancel={onCancel}
      showCloseButton
      title={t('matchmaking.bannedDialog.title', 'Banned from matchmaking')}
      buttons={[
        <TextButton key='okay' label={t('common.actions.okay', 'Okay')} onClick={onCancel} />,
      ]}>
      <Content>
        <BodyLarge>
          {t(
            'matchmaking.bannedDialog.description',
            'You have been temporarily banned from matchmaking for failing to ready up, or ' +
              'failing to join matches.',
          )}
        </BodyLarge>
        {bannedUntil && bannedUntilStr.length ? (
          <div>
            <BodyLarge>{t('matchmaking.bannedDialog.bannedFor', 'You are banned for:')}</BodyLarge>
            <DurationText>{bannedUntilStr}</DurationText>
          </div>
        ) : null}
      </Content>
    </StyledDialog>
  )
}
