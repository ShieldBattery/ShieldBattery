import { useAtomValue } from 'jotai'
import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import { lazy, Suspense, useRef } from 'react'
import ReactDOM from 'react-dom'
import styled from 'styled-components'
import { FocusTrap } from '../dom/focus-trap'
import { useExternalElementRef } from '../dom/use-external-element-ref'
import { KeyListenerBoundary } from '../keyboard/key-listener'
import { zIndexDialogScrim } from '../material/zindex'
import { useNavigationTrap } from '../navigation/navigation-trap'
import { LoadingDotsArea } from '../progress/dots'
import { isInDraftAtom } from './draft-atoms'

const LoadableDraftScreen = lazy(() =>
  import('./draft-screen').then(m => ({ default: m.DraftScreen })),
)

const Root = styled(m.div)`
  position: absolute;
  top: var(--sb-system-bar-height, 0);
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: calc(100% - var(--sb-system-bar-height, 0));

  background-color: var(--theme-surface);
  contain: content;
  z-index: ${zIndexDialogScrim - 1};
`

const NAVIGATION_TRAP_KEY = 'DRAFT_SCREEN_NAV_TRAP'

export function DraftScreenOverlay() {
  const inDraft = useAtomValue(isInDraftAtom)
  const focusableRef = useRef<HTMLSpanElement>(null)
  const portalRef = useExternalElementRef()

  useNavigationTrap(NAVIGATION_TRAP_KEY, inDraft)

  return ReactDOM.createPortal(
    <AnimatePresence>
      {inDraft ? (
        <KeyListenerBoundary>
          <FocusTrap focusableRef={focusableRef}>
            <span ref={focusableRef} tabIndex={-1}>
              <Root
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', duration: 0.6 }}>
                <Suspense fallback={<LoadingDotsArea />}>
                  <LoadableDraftScreen />
                </Suspense>
              </Root>
            </span>
          </FocusTrap>
        </KeyListenerBoundary>
      ) : undefined}
    </AnimatePresence>,
    portalRef.current,
  )
}
