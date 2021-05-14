import React, { useState } from 'react'
import { createDevTools } from 'redux-devtools'
import DockMonitor from 'redux-devtools-dock-monitor'
import InspectorMonitor from 'redux-devtools-inspector'
import styled from 'styled-components'

// NOTE(tec27): !importants here are to ensure our styling for our app's root div doesn't override
// this stuff
const Container = styled.div`
  position: fixed !important;
  width: 0px !important;
  height: 0px !important;
  top: 0px !important;
  left: 0px !important;
  z-index: 99999999 !important;

  div[class*='inspector-'] {
    contain: strict;
  }
  div[class*='actionListItem-'] {
    contain: content;
  }
`

let isVisible = false
let setIsVisible = val => {
  isVisible = val
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
function PerformantInspectorMonitor(props) {
  ;[isVisible, setIsVisible] = useState(false)

  return isVisible ? (
    <InspectorMonitor {...props} theme='nicinabox' invertTheme={false} supportImmutable={true} />
  ) : (
    <EmptyComponent />
  )
}

PerformantInspectorMonitor.update = function (monitorProps, state, action) {
  if (action.type === '@@redux-devtools-log-monitor/TOGGLE_VISIBILITY') {
    setIsVisible(!isVisible)
  }

  return InspectorMonitor.update(monitorProps, state, action)
}

export const DevTools = createDevTools(
  <DockMonitor toggleVisibilityKey='ctrl-h' changePositionKey='ctrl-q' defaultIsVisible={false}>
    <PerformantInspectorMonitor />
  </DockMonitor>,
)

export default function DevToolsContainer() {
  return (
    <Container>
      <DevTools />
    </Container>
  )
}
