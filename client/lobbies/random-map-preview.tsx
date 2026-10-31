import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { titleMedium } from '../styles/typography'

const Preview = styled.div`
  width: 100%;
  height: 100%;
  min-height: 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: radial-gradient(
    circle at center,
    var(--theme-container-high),
    var(--theme-container-low)
  );
  color: var(--theme-primary);
`

const Label = styled.div`
  ${titleMedium};
  color: var(--theme-on-surface);
  text-align: center;
`

/** A map whose identity is determined on the server only once the game begins loading. */
export function RandomMapPreview({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const label = t('lobbies.randomMap.label', 'Random Map')
  return (
    <Preview role='img' aria-label={label}>
      <MaterialIcon icon='question_mark' size={compact ? 32 : 64} />
      {!compact ? <Label>{label}</Label> : null}
    </Preview>
  )
}
