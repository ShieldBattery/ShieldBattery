import { Trans, useTranslation } from 'react-i18next'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { MaterialIcon } from '../icons/material/material-icon'
import { ActionlessNotification } from '../notifications/notifications'
import { useAppDispatch } from '../redux-hooks'
import { styledWithAttrs } from '../styles/styled-with-attrs'

const ColoredRulesIcon = styledWithAttrs(MaterialIcon, { icon: 'gavel', size: 36 })`
  flex-shrink: 0;
  color: var(--theme-amber);
`

export interface RulesUpdateNotificationUiProps {
  showDivider: boolean
  read: boolean
  ref?: React.Ref<HTMLDivElement>
}

export function RulesUpdateNotificationUi({
  showDivider,
  read,
  ref,
}: RulesUpdateNotificationUiProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  return (
    <ActionlessNotification
      ref={ref}
      showDivider={showDivider}
      read={read}
      icon={<ColoredRulesIcon />}
      text={
        <span>
          <Trans t={t} i18nKey='rules.updateNotification'>
            ShieldBattery's{' '}
            <a
              href='#'
              onClick={e => {
                e.preventDefault()
                dispatch(openDialog({ type: DialogType.Rules }))
              }}>
              platform rules
            </a>{' '}
            have been updated.
          </Trans>
        </span>
      }
    />
  )
}
