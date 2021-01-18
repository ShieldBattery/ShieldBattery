import React from 'react'
import styled from 'styled-components'
import { createDevTools } from 'redux-devtools'
import DockMonitor from 'redux-devtools-dock-monitor'
import InspectorMonitor from 'redux-devtools-inspector'

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

export const DevTools = createDevTools(
  <DockMonitor toggleVisibilityKey='ctrl-h' changePositionKey='ctrl-q' defaultIsVisible={false}>
    <InspectorMonitor theme='nicinabox' invertTheme={false} supportImmutable={true} />
  </DockMonitor>,
)

export default function DevToolsContainer() {
  return (
    <Container>
      <DevTools />
    </Container>
  )
}
