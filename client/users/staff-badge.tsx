import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import Logo from '../logos/logo-no-bg.svg'
import { Tooltip } from '../material/tooltip'

const BadgeLogo = styled(Logo)`
  width: 16px;
  height: 16px;
`

const BadgeTooltip = styled(Tooltip)`
  display: flex;
  align-items: center;
`

/**
 * A small marker rendered next to a username to show that the account speaks for ShieldBattery.
 */
export function StaffBadge({ className }: { className?: string }) {
  const { t } = useTranslation()

  return (
    <BadgeTooltip
      className={className}
      text={t('users.staffBadge.tooltip', 'ShieldBattery staff')}
      position='top'>
      <BadgeLogo />
    </BadgeTooltip>
  )
}
