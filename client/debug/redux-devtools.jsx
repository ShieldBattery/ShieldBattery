import React from 'react'
import { createDevTools } from 'redux-devtools'
import DockMonitor from 'redux-devtools-dock-monitor'
import InspectorMonitor from 'redux-devtools-inspector'

const DevTools = createDevTools(
  <DockMonitor toggleVisibilityKey='ctrl-h' changePositionKey='ctrl-q' defaultIsVisible={false}>
    <InspectorMonitor theme='nicinabox' invertTheme={false} supportImmutable={true} />
  </DockMonitor>,
)

export default DevTools
