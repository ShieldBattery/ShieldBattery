import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import { lazy, Suspense, useState } from 'react'
import ReactDOM from 'react-dom'
import styled from 'styled-components'
import { useHistoryState } from 'wouter/use-browser-location'
import { FocusTrap } from '../dom/focus-trap'
import { useExternalElement } from '../dom/use-external-element-ref'
import { KeyListenerBoundary } from '../keyboard/key-listener'
import { zIndexSettings } from '../material/zindex'
import { pushCurrentWithState } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'

const PRACTICE_RESULT_OPEN_STATE = 'PRACTICE_RESULT:open'

const LoadablePracticeResult = lazy(() =>
  import('./practice-result').then(m => ({ default: m.PracticeResult })),
)

/**
 * Shows the result screen for the latest practice session over whatever page is open. It lives in
 * a history entry of its own at the same URL, so closing it (or going back) returns to that page
 * with its state untouched.
 */
export function showPracticeResult(): void {
  if (history.state !== PRACTICE_RESULT_OPEN_STATE) {
    pushCurrentWithState(PRACTICE_RESULT_OPEN_STATE)
  }
}

export function closePracticeResult(): void {
  if (history.state === PRACTICE_RESULT_OPEN_STATE) {
    history.back()
  }
}

const Root = styled(m.div)`
  position: fixed;
  inset: var(--sb-system-bar-height, 0) 0 0;
  z-index: ${zIndexSettings - 2};

  background-color: var(--theme-surface);
`

export function PracticeResultOverlay() {
  const isOpen = useHistoryState() === PRACTICE_RESULT_OPEN_STATE
  const [focusableElem, setFocusableElem] = useState<HTMLSpanElement | null>(null)
  const portalElem = useExternalElement()

  return ReactDOM.createPortal(
    <AnimatePresence>
      {isOpen ? (
        <KeyListenerBoundary>
          <FocusTrap focusableElem={focusableElem}>
            <span ref={setFocusableElem} tabIndex={-1}>
              <Root
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', duration: 0.4, bounce: 0 }}>
                <Suspense fallback={<LoadingDotsArea />}>
                  <LoadablePracticeResult />
                </Suspense>
              </Root>
            </span>
          </FocusTrap>
        </KeyListenerBoundary>
      ) : null}
    </AnimatePresence>,
    portalElem,
  )
}
