import React from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { DISCORD_URL } from '../common/url-constants'
import logger from './logging/logger'
import { RaisedButton } from './material/button'
import { colorTextSecondary } from './styles/colors'
import GlobalStyle from './styles/global'
import ResetStyle from './styles/reset'
import { Headline5, subtitle1 } from './styles/typography'
import { WindowControls, WindowControlsStyle } from './system-bar/window-controls'

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
            <ContentsErrorBoundary>
              <ErrorContents rootError={error} />
            </ContentsErrorBoundary>
          </Container>
        </>
      )
    }

    return this.props.children
  }
}

export interface ContentsErrorBoundaryProps {
  children: ReturnType<typeof ErrorContents>
}

interface ContentsErrorBoundaryState {
  hasTranslationError?: boolean
}

class ContentsErrorBoundary extends React.Component<
  ContentsErrorBoundaryProps,
  ContentsErrorBoundaryState
> {
  override state: ContentsErrorBoundaryState = {}

  static getDerivedStateFromError(error: Error) {
    return {
      hasTranslationError: error,
    }
  }

  override render() {
    const { children } = this.props
    const { hasTranslationError } = this.state

    return hasTranslationError ? React.cloneElement(children, { hasTranslationError }) : children
  }
}

function ErrorContents({
  rootError,
  hasTranslationError,
}: {
  rootError: Error
  hasTranslationError?: boolean
}) {
  const { t } = useTranslation()

  const reloadApp = () => {
    if (location.pathname === '/') {
      location.reload()
    } else {
      // Put them back at the root of the app in case the place they were was causing errors
      location.pathname = '/'
    }
  }

  return hasTranslationError ? (
    <>
      <Headline5>Something went wrong :(</Headline5>
      <ErrorInfo>{String(rootError.stack ?? rootError)}</ErrorInfo>
      <Instructions>
        Please report this issue to us in our{' '}
        <a href={DISCORD_URL} title='Discord' target='_blank' rel='noopener'>
          Discord
        </a>
        .
      </Instructions>
      <RaisedButton label='Reload app' color='primary' onClick={reloadApp} />
    </>
  ) : (
    <>
      <Headline5>{t('rootErrorBoundary.title', 'Something went wrong :(')}</Headline5>
      <ErrorInfo>{String(rootError.stack ?? rootError)}</ErrorInfo>
      <Instructions>
        <Trans t={t} i18nKey='rootErrorBoundary.contents'>
          Please report this issue to us in our{' '}
          <a href={DISCORD_URL} title='Discord' target='_blank' rel='noopener'>
            Discord
          </a>
          .
        </Trans>
      </Instructions>
      <RaisedButton
        label={t('rootErrorBoundary.reloadApp', 'Reload app')}
        color='primary'
        onClick={reloadApp}
      />
    </>
  )
}
