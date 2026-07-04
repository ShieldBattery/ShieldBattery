import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  RestrictionKind,
  RestrictionReason,
  restrictionReasonToLabel,
} from '../../common/users/restrictions'
import { longTimestamp } from '../i18n/date-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { ActionlessNotification } from '../notifications/notifications'
import { styledWithAttrs } from '../styles/styled-with-attrs'
import { titleMedium } from '../styles/typography'

const ColoredIcon = styledWithAttrs(MaterialIcon, { size: 36 })`
  flex-shrink: 0;
  color: var(--theme-negative);
`

export interface UserRestrictedNotificationUiProps {
  ref?: React.Ref<HTMLDivElement>
  showDivider: boolean
  read: boolean
  kind: RestrictionKind
  endTime: number
  reason?: RestrictionReason
}

function kindToIcon(kind: RestrictionKind): string {
  switch (kind) {
    case RestrictionKind.Chat:
      return 'comments_disabled'
    case RestrictionKind.Reporting:
      return 'flag'
    case RestrictionKind.Matchmaking:
      return 'block'
    default:
      return kind satisfies never
  }
}

const SpecialText = styled.div`
  ${titleMedium};
  margin-top: 4px;

  & + div {
    margin-top: 12px;
  }
`

export function UserRestrictedNotificationUi({
  ref,
  showDivider,
  read,
  kind,
  endTime,
  reason,
}: UserRestrictedNotificationUiProps) {
  const { t } = useTranslation()

  const reasonLabel = reason !== undefined ? restrictionReasonToLabel(reason, t) : undefined
  const endText = longTimestamp.format(endTime)

  let intro: string
  switch (kind) {
    case RestrictionKind.Chat:
      intro = t(
        'auth.restriction.chat.notification',
        'Your account has been restricted from sending chat messages.',
      )
      break
    case RestrictionKind.Reporting:
      intro = t(
        'auth.restriction.reporting.notification',
        'Your account has been restricted from reporting players.',
      )
      break
    case RestrictionKind.Matchmaking:
      intro = t(
        'auth.restriction.matchmaking.notification',
        'Your account has been restricted from matchmaking.',
      )
      break
    default:
      kind satisfies never
      return null
  }

  return (
    <ActionlessNotification
      ref={ref}
      showDivider={showDivider}
      read={read}
      icon={<ColoredIcon icon={kindToIcon(kind)} />}
      text={
        <span>
          <div>{intro}</div>
          {reasonLabel !== undefined ? (
            <>
              <div>{t('auth.restriction.reasonLabel', 'Reason:')}</div>
              <SpecialText>{reasonLabel}</SpecialText>
            </>
          ) : null}
          <div>{t('auth.restriction.endsOn', 'This restriction will end on:')}</div>
          <SpecialText>{endText}</SpecialText>
        </span>
      }
    />
  )
}
