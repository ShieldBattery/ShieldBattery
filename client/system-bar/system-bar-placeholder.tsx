import * as React from 'react'
import { useLayoutEffect } from 'react'
import styled from 'styled-components'
import logger from '../logging/logger'
import { zIndexSystemBar } from '../material/zindex'

// This file must stay free of Redux/Jotai/network dependencies, since it renders when the
// rest of the app has failed to load or crashed.

export const SystemBarRoot = styled.header`
  flex-grow: 0;
  flex-shrink: 0;

  width: 100%;
  height: 32px;
  margin: 0;
  padding: 0;
  position: relative;

  display: flex;
  flex-direction: row;

  background-color: var(--color-grey-blue20);
  overflow: hidden;
  z-index: ${zIndexSystemBar};

  -webkit-app-region: drag;
`

/** Reserves the system bar's height for the rest of the layout while this component is mounted. */
export function useSystemBarHeight() {
  useLayoutEffect(() => {
    document.body.style.setProperty('--sb-system-bar-height', '32px')
    return () => {
      document.body.style.removeProperty('--sb-system-bar-height')
    }
  }, [])
}

/**
 * An empty, draggable system bar, for when the real one can't render (it's still loading, or it
 * crashed). Electron windows are frameless, so without this the window can't be moved.
 */
export function SystemBarPlaceholder() {
  useSystemBarHeight()
  return <SystemBarRoot />
}

interface SystemBarErrorBoundaryState {
  hasError?: boolean
}

/** Swaps in the placeholder bar if the real one crashes, rather than taking down the whole app. */
export class SystemBarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  SystemBarErrorBoundaryState
> {
  override state: SystemBarErrorBoundaryState = {}

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error(`Error in system bar: ${String(error.stack ?? error)}`)
    logger.error(`React stack:\n${errorInfo.componentStack}`)
  }

  override render() {
    return this.state.hasError ? <SystemBarPlaceholder /> : this.props.children
  }
}
