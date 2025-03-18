import createEmotionCache from '@emotion/cache'
import { CacheProvider } from '@emotion/react'
import { createDevTools } from '@redux-devtools/core'
import { DockMonitor } from '@redux-devtools/dock-monitor'
import { InspectorMonitor } from '@redux-devtools/inspector-monitor'
import React, { useEffect, useState } from 'react'
import styled from 'styled-components'

const emotionCache = createEmotionCache({
  key: 'redux-dev',
  nonce: (window as any).SB_CSP_NONCE,
})

const Container = styled.div<{ $hidden?: boolean }>`
  position: fixed !important;
  z-index: 99999999 !important;
  pointer-events: none;

  .redux-devtools-visible & {
    pointer-events: auto;
  }

  /* Root of DockMonitor */
  & > div {
    top: var(--sb-system-bar-height, 0px) !important;
    left: 0px !important;
    right: 0px !important;
    bottom: 0px !important;
    width: unset !important;
    height: unset !important;
  }
  /* Actual dock elements */
  & > div > div {
    position: absolute !important;
  }

  div[class*='inspector-'] {
    contain: strict;
  }
  div[class*='actionListItem-'] {
    contain: content;
  }
`

const updateInspectorMonitorListeners: Array<() => void> = []
let isVisible = false
const setIsVisible = (val: boolean) => {
  isVisible = val
  document.body.classList.toggle('redux-devtools-visible', val)

  queueMicrotask(() => {
    for (const listener of updateInspectorMonitorListeners) {
      listener()
    }
  })
}

// NOTE(tec27): This prevents a flash of white as the drawer closes
const EmptyComponent = styled.div`
  width: 100%;
  height: 100%;
  background-color: #2a2f3a;
`

/**
 * A wrapper around ReduxDevtoolsInspector that removes the inspector from the component tree
 * entirely if it's not visible. The underlying component's layout code is quite expensive even
 * when non-visible and occurs on every action dispatched, so it tends to make things quite laggy.
 * This is mildly okay when you actually want to see the actions being dispatched, but pretty darn
 * annoying if the UI isn't even onscreen.
 */
function PerformantInspectorMonitor(props: any) {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const update = () => {
      setIsVisible(document.body.classList.contains('redux-devtools-visible'))
    }
    updateInspectorMonitorListeners.push(update)

    return () => {
      const index = updateInspectorMonitorListeners.indexOf(update)
      if (index !== -1) {
        updateInspectorMonitorListeners.splice(index, 1)
      }
    }
  }, [])

  return isVisible ? (
    <InspectorMonitor {...props} theme='nicinabox' invertTheme={false} supportImmutable={true} />
  ) : (
    <EmptyComponent />
  )
}

PerformantInspectorMonitor.update = function (monitorProps: any, state: any, action: any) {
  if (action.type === '@@redux-devtools-log-monitor/TOGGLE_VISIBILITY') {
    setIsVisible(!isVisible)
  }

  return InspectorMonitor.update(monitorProps, state, action)
}

export const DevTools: any = createDevTools(
  <DockMonitor toggleVisibilityKey='ctrl-h' changePositionKey='ctrl-q' defaultIsVisible={false}>
    <PerformantInspectorMonitor />
  </DockMonitor>,
)

export default function DevToolsContainer() {
  return (
    <CacheProvider value={emotionCache}>
      <Container>
        <DevTools />
      </Container>
    </CacheProvider>
  )
}
