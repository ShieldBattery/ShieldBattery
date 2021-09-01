import React from 'react'
import styled from 'styled-components'
import { DISCORD_URL } from '../common/url-constants'
import { WindowControls, WindowControlsStyle } from './app-bar/window-controls'
import logger from './logging/logger'
import { RaisedButton } from './material/button'
import { colorTextSecondary } from './styles/colors'
import GlobalStyle from './styles/global'
import ResetStyle from './styles/reset'
import { Headline5, subtitle1 } from './styles/typography'

export interface RootErrorBoundaryProps {
  /** A class name that will be applied to the root container that displays errors. */
  className?: string
  children: React.ReactNode
}

interface RootErrorBoundaryState {
  error?: Error
}

const Container = styled.div`
  width: 100%;
  height: 100%;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
`

const ErrorInfo = styled.div`
  ${subtitle1};
  max-width: 960px;
  margin: 16px;

  color: ${colorTextSecondary};
  white-space: pre;

  &,
  & * {
    user-select: text;
  }
`

const Instructions = styled.div`
  ${subtitle1};
  max-width: 960px;
  margin: 16px 16px 32px;
`

/**
 * A React error boundary that is intended to be attached at the application root. This should be
 * considered the error boundary of last resort, and ideally errors would be caught deeper in the
 * tree (by adding more error boundaries).
 */
export class RootErrorBoundary extends React.Component<
  RootErrorBoundaryProps,
  RootErrorBoundaryState
> {
  override state: RootErrorBoundaryState = {}

  static getDerivedStateFromError(error: Error) {
    return {
      error,
    }
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error(`RootErrorBoundary caught an error: ${error.stack ?? error}`)
    logger.error(`React stack:\n${errorInfo.componentStack}`)
  }

  override render() {
    if (this.state.error) {
      const { error } = this.state

      return (
        <>
          <ResetStyle />
          <GlobalStyle />
          <WindowControlsStyle />
          <WindowControls />
          <Container>
            <Headline5>Something went wrong :(</Headline5>
            <ErrorInfo>{error.stack ?? error}</ErrorInfo>
            <Instructions>
              Please report this issue to us in our{' '}
              <a href={DISCORD_URL} title='Discord' target='_blank' rel='noopener'>
                Discord
              </a>
              .
            </Instructions>
            <RaisedButton label='Reload app' color='primary' onClick={this.reloadApp} />
          </Container>
        </>
      )
    }

    return this.props.children
  }

  reloadApp = () => {
    if (location.pathname === '/') {
      location.reload()
    } else {
      // Put them back at the root of the app in case the place they were was causing errors
      location.pathname = '/'
    }
  }
}
