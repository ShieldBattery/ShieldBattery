import { useEffect } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user-id'
import { TransInterpolation } from '../i18n/i18next'
import { ActionlessNotification } from '../notifications/notifications'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { titleSmall } from '../styles/typography'
import { getBatchUserInfo } from '../users/action-creators'
import { CommendIcon } from './commend-icon'

const ColoredIcon = styled(CommendIcon).attrs({ size: 36 })`
  flex-shrink: 0;
  color: var(--theme-amber);
`

const Username = styled.span`
  ${titleSmall};
`

export interface CommendReceivedNotificationUiProps {
  ref?: React.Ref<HTMLDivElement>
  commenderId: SbUserId
  showDivider: boolean
  read: boolean
}

export function CommendReceivedNotificationUi({
  ref,
  commenderId,
  showDivider,
  read,
}: CommendReceivedNotificationUiProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const username = useAppSelector(s => s.users.byId.get(commenderId)?.name)

  useEffect(() => {
    dispatch(getBatchUserInfo(commenderId))
  }, [commenderId, dispatch])

  return (
    <ActionlessNotification
      ref={ref}
      showDivider={showDivider}
      read={read}
      icon={<ColoredIcon />}
      text={
        <span>
          <Trans t={t} i18nKey='gameCommend.received'>
            <Username>{{ user: username ?? '' } as TransInterpolation}</Username> has commended you.
          </Trans>
        </span>
      }
    />
  )
}
