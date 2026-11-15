import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MatchmakingBanReason } from '../../common/matchmaking'
import { longTimestamp } from '../i18n/date-formats'
import { useFormat } from '../i18n/locale-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { ActionlessNotification } from '../notifications/notifications'
import { styledWithAttrs } from '../styles/styled-with-attrs'
import { titleMedium } from '../styles/typography'
import { matchmakingBanText, matchmakingWarningText } from './ban-reason-text'

const ColoredIcon = styledWithAttrs(MaterialIcon, { size: 36 })<{ $warning: boolean }>`
  flex-shrink: 0;
  color: ${props => (props.$warning ? 'var(--theme-amber)' : 'var(--theme-negative)')};
`

const SpecialText = styled.div`
  ${titleMedium};
  margin-top: 4px;
`

export interface MatchmakingBanNotificationUiProps {
  ref?: React.Ref<HTMLDivElement>
  showDivider: boolean
  read: boolean
  bannedUntil?: number
  /** Absent for notifications stored without a reason. */
  reason?: MatchmakingBanReason
}

export function MatchmakingBanNotificationUi({
  ref,
  showDivider,
  read,
  bannedUntil,
  reason,
}: MatchmakingBanNotificationUiProps) {
  const { t } = useTranslation()
  const longTimestampFormat = useFormat(longTimestamp)

  const isWarning = bannedUntil === undefined
  const warningText = reason
    ? matchmakingWarningText(t, reason)
    : t(
        'matchmaking.banNotification.warning',
        'You received a matchmaking warning for not readying up or not loading into a match. Doing it again soon will get you temporarily banned from matchmaking.',
      )

  return (
    <ActionlessNotification
      ref={ref}
      showDivider={showDivider}
      read={read}
      icon={<ColoredIcon icon={isWarning ? 'warning' : 'block'} $warning={isWarning} />}
      text={
        isWarning ? (
          warningText
        ) : (
          <span>
            <div>
              {reason
                ? matchmakingBanText(t, reason)
                : t(
                    'matchmaking.banNotification.ban',
                    "You've been temporarily banned from matchmaking for not readying up or not loading into a match.",
                  )}
            </div>
            <div>{t('matchmaking.banNotification.endsOn', 'This ban will end on:')}</div>
            <SpecialText>{longTimestampFormat.format(bannedUntil)}</SpecialText>
          </span>
        )
      }
    />
  )
}
