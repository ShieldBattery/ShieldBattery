import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  RestrictionKind,
  RestrictionReason,
  restrictionReasonToLabel,
} from '../../common/users/restrictions'
import { longTimestamp } from '../i18n/date-formats'
import { TransInterpolation } from '../i18n/i18next'
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
  reason: RestrictionReason
}

function kindToIcon(kind: RestrictionKind): string {
  switch (kind) {
    case RestrictionKind.Chat:
      return 'comments_disabled'
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

  const reasonLabel = restrictionReasonToLabel(reason, t)
  const endText = longTimestamp.format(endTime)

  let text = <></>
  if (kind === RestrictionKind.Chat) {
    text = (
      <span>
        <Trans t={t} i18nKey='auth.restriction.chat.notification'>
          <div>
            Your account has been restricted from sending chat messages for the following reason:
          </div>
          <SpecialText>{{ reasonLabel } as TransInterpolation}</SpecialText>
          <div>This restriction will end on:</div>
          <SpecialText>{{ endText } as TransInterpolation}</SpecialText>
        </Trans>
      </span>
    )
  } else {
    kind satisfies never
    return null
  }

  return (
    <ActionlessNotification
      ref={ref}
      showDivider={showDivider}
      read={read}
      icon={<ColoredIcon icon={kindToIcon(kind)} />}
      text={text}
    />
  )
}
