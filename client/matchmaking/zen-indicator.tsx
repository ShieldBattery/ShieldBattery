import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { Tooltip } from '../material/tooltip'

const Root = styled(Tooltip)`
  display: inline-flex;
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
`

export function ZenIndicator() {
  const { t } = useTranslation()
  const label = t('matchmaking.zen.chatDisabled', 'Zen mode: match chat disabled')

  return (
    <Root text={label} position='top'>
      <span role='img' aria-label={label}>
        <MaterialIcon icon='self_improvement' size={20} />
      </span>
    </Root>
  )
}
