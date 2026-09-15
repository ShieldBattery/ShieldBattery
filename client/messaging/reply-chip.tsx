import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { TransInterpolation } from '../i18n/i18next'
import { MaterialIcon } from '../icons/material/material-icon'
import { buttonReset } from '../material/button-reset'
import { labelMedium } from '../styles/typography'

const ChipRoot = styled.span`
  ${labelMedium};
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 2px 0 8px;
  border-radius: 10px;

  background: var(--color-purple40);
  color: var(--color-purple95);
  white-space: nowrap;
  user-select: none;
`

const ChipName = styled.span`
  font-weight: 600;
`

const ClearButton = styled.button`
  ${buttonReset};

  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;

  color: var(--color-purple80);

  &:hover {
    color: var(--color-purple95);
  }

  &:focus-visible {
    outline: 2px solid var(--color-purple95);
    outline-offset: 1px;
  }
`

export interface ReplyChipProps {
  name: string
  onClear: () => void
}

/**
 * A pill shown as leading content in the message input while composing a reply, naming who the
 * reply is directed at. Clearing it (via the trailing button) drops back to composing a regular
 * message.
 */
export function ReplyChip({ name, onClear }: ReplyChipProps) {
  const { t } = useTranslation()

  return (
    <ChipRoot>
      <Trans t={t} i18nKey='messaging.replyChip.replyingTo'>
        Replying to <ChipName>{{ name } as TransInterpolation}</ChipName>
      </Trans>
      <ClearButton
        type='button'
        aria-label={t('messaging.replyChip.stopReplying', 'Stop replying')}
        title={t('messaging.replyChip.stopReplying', 'Stop replying')}
        onClick={onClear}>
        <MaterialIcon icon='close' size={16} />
      </ClearButton>
    </ChipRoot>
  )
}
