import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { TextButton } from '../material/button'
import { bodyMedium } from '../styles/typography'

const Root = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 8px;
`

const ErrorIcon = styled(MaterialIcon)`
  flex-shrink: 0;
  color: var(--theme-error);
`

const Message = styled.div`
  ${bodyMedium};
  min-width: 0;
  color: var(--theme-on-surface-variant);
`

/**
 * The row can be as narrow as a channel's user list, where the message and the button together
 * don't fit on one line. The message is the part that may wrap; the button keeps its intrinsic
 * width so its label is never cut off mid-word.
 */
const RetryButton = styled(TextButton)`
  flex-shrink: 0;
`

/**
 * The affordance a list shows at an edge whose last load failed: what went wrong in fixed copy,
 * plus a way to ask for that load again. The message never carries the error itself — a status code
 * or a network library's wording means nothing to the reader, and the raw error belongs in the log
 * the request's failure handler writes.
 */
export function LoadErrorRow({
  message,
  onRetry,
  className,
}: {
  message: string
  onRetry: () => void
  className?: string
}) {
  const { t } = useTranslation()

  return (
    <Root className={className}>
      <ErrorIcon icon='error' size={20} />
      <Message>{message}</Message>
      <RetryButton label={t('common.actions.retry', 'Retry')} onClick={onRetry} />
    </Root>
  )
}
