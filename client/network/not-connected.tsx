import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { DisplayMedium } from '../styles/typography'

const Root = styled.div`
  width: 100%;
  height: 100%;
  padding-bottom: 64px;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;

  color: var(--theme-on-surface-variant);
`

export function NotConnected({ className }: { className?: string }) {
  const { t } = useTranslation()

  return (
    <Root className={className}>
      <MaterialIcon icon='cloud_off' size={96} />
      <DisplayMedium>{t('network.notConnectedText', 'Not connected')}</DisplayMedium>
    </Root>
  )
}
