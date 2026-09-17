import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { LoadErrorRow } from '../lists/load-error-row'
import { JUMP_TO_BOTTOM_CLEARANCE_PX } from './jump-to-bottom-layout'
import type { MessageLoadErrorKind } from './message-load-error'

/**
 * The newer edge is the very bottom of the list, where the floating jump-to-present button sits for
 * as long as the window is detached from the present — which a failed newer page always leaves it.
 * Clearing the button keeps the row's message and Retry both visible and clickable.
 */
const NewerEdgeRow = styled(LoadErrorRow)`
  margin-bottom: ${JUMP_TO_BOTTOM_CLEARANCE_PX}px;
`

/**
 * The row a message list shows at an edge whose last load failed, offering to make that load again.
 */
export function MessageLoadErrorRow({
  kind,
  onRetry,
}: {
  kind: MessageLoadErrorKind
  onRetry: () => void
}) {
  const { t } = useTranslation()

  let message: string
  switch (kind) {
    case 'history':
      message = t('messaging.errors.loadOlderFailed', "Couldn't load older messages")
      break
    case 'newer':
      message = t('messaging.errors.loadNewerFailed', "Couldn't load newer messages")
      break
    case 'around':
      message = t('messaging.errors.loadFailed', "Couldn't load messages")
      break
  }

  return kind === 'newer' ? (
    <NewerEdgeRow message={message} onRetry={onRetry} />
  ) : (
    <LoadErrorRow message={message} onRetry={onRetry} />
  )
}
