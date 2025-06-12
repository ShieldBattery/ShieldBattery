import * as React from 'react'
import { useLayoutEffect } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { DISCORD_URL } from '../common/url-constants'
import logger from './logging/logger'
import { FilledButton } from './material/button'
import { zIndexSystemBar } from './material/zindex'
import GlobalStyle from './styles/global'
import ResetStyle from './styles/reset'
import { TitleLarge, bodyLarge } from './styles/typography'
import { WindowControls } from './system-bar/window-controls'

export interface RootErrorBoundaryProps {
  /** A class name that will be applied to the root container that displays errors. */
  className?: string
  children: React.ReactNode
  isVeryTopLevel?: boolean
}

interface RootErrorBoundaryState {
  error?: Error
}

// Dumb replacement for the system bar that doesn't need Redux to function
const SystemBarReplacementRoot = styled.header`
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

function SystemBarReplacement() {
  useLayoutEffect(() => {
    document.body.style.setProperty('--sb-system-bar-height', '32px')
    return () => {
      document.body.style.removeProperty('--sb-system-bar-height')
    }
  }, [])
  return <SystemBarReplacementRoot />
}

const Container = styled.div`
  width: 100%;
  height: calc(100% - var(--sb-system-bar-height, 0px));

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
`

const ErrorInfo = styled.div`
  ${bodyLarge};
  max-width: 960px;
  margin: 16px;

  color: var(--theme-on-surface-variant);
  white-space: pre;

  &,
  & * {
    user-select: text;
  }
`

const Instructions = styled.div`
  ${bodyLarge};
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
    logger.error(`RootErrorBoundary caught an error: ${String(error.stack ?? error)}`)
    logger.error(`React stack:\n${errorInfo.componentStack}`)
  }

  override render() {
    if (this.state.error) {
      const { error } = this.state

      return (
        <>
          {this.props.isVeryTopLevel ? (
            <>
              <ResetStyle />
              <GlobalStyle />
              {IS_ELECTRON ? <WindowControls /> : undefined}
              {IS_ELECTRON ? <SystemBarReplacement /> : undefined}
            </>
          ) : undefined}
          <Container>
            <ContentsErrorBoundary rootError={error} />
          </Container>
        </>
      )
    }

    return this.props.children
  }
}

export interface ContentsErrorBoundaryProps {
  rootError: Error
}

interface ContentsErrorBoundaryState {
  hasTranslationError?: boolean
}

/**
 * A React error boundary that is specifically meant to catch the errors in calling
 * translation-related functions when displaying the error contents. If there are any errors in
 * displaying the translated version of the error contents, we fallback to displaying the static,
 * English version of the error contents.
 */
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
    const { rootError } = this.props
    const { hasTranslationError } = this.state

    return hasTranslationError ? (
      <StaticErrorContents rootError={rootError} onReloadAppClick={this.reloadApp} />
    ) : (
      <TranslatedErrorContents rootError={rootError} onReloadAppClick={this.reloadApp} />
    )
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

interface ErrorContentsProps {
  rootError: Error
  onReloadAppClick?: () => void
}

function TranslatedErrorContents({ rootError, onReloadAppClick }: ErrorContentsProps) {
  const { t } = useTranslation()

  return (
    <>
      <TitleLarge>{t('rootErrorBoundary.title', 'Something went wrong :(')}</TitleLarge>
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
      <FilledButton
        label={t('rootErrorBoundary.reloadApp', 'Reload app')}
        onClick={onReloadAppClick}
      />
    </>
  )
}

function StaticErrorContents({ rootError, onReloadAppClick }: ErrorContentsProps) {
  return (
    <>
      <TitleLarge>Something went wrong :(</TitleLarge>
      <ErrorInfo>{String(rootError.stack ?? rootError)}</ErrorInfo>
      <Instructions>
        Please report this issue to us in our{' '}
        <a href={DISCORD_URL} title='Discord' target='_blank' rel='noopener'>
          Discord
        </a>
        .
      </Instructions>
      <FilledButton label='Reload app' onClick={onReloadAppClick} />
    </>
  )
}
