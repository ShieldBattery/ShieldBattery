import * as React from 'react'
import { useEffect } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { DISCORD_URL } from '../common/url-constants'
import { requestBugReportOnNextLoad } from './bugs/pending-bug-report'
import logger from './logging/logger'
import { FilledButton, OutlinedButton } from './material/button'
import GlobalStyle from './styles/global'
import ResetStyle from './styles/reset'
import { bodyLarge, TitleLarge } from './styles/typography'
import { SystemBarPlaceholder } from './system-bar/system-bar-placeholder'
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

const Container = styled.div`
  width: 100%;
  height: calc(100% - var(--sb-system-bar-height, 0px));
  overflow-y: auto;

  display: flex;
  flex-direction: column;
  align-items: center;

  /*
    Auto margins center the contents vertically, but unlike justify-content: center they
    collapse when the contents overflow, so a tall stack stays scrollable from its top.
  */
  & > :first-child {
    margin-top: auto;
  }

  & > :last-child {
    margin-bottom: auto;
  }
`

const ErrorInfo = styled.div`
  ${bodyLarge};
  max-width: 960px;
  margin: 16px;

  color: var(--theme-on-surface-variant);
  white-space: pre-wrap;
  overflow-wrap: anywhere;

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

const Actions = styled.div`
  display: flex;
  gap: 16px;
`

/** How many stack frames to display, past which it's usually just React walking the tree. */
const MAX_DISPLAYED_FRAMES = 20

/**
 * Formats `error` with its message, which only V8 includes in `error.stack` (WebKit and Firefox
 * stacks are just the frames).
 */
function describeError(error: unknown, maxFrames = Infinity): string {
  if (!(error instanceof Error)) {
    return String(error)
  }

  const header = `${error.name}: ${error.message}`
  const stack = error.stack ?? ''
  const frames = (stack.startsWith(header) ? stack.slice(header.length) : stack)
    .split('\n')
    .filter(f => f.trim() !== '')

  const shown = frames.slice(0, maxFrames)
  if (frames.length > shown.length) {
    shown.push(`... ${frames.length - shown.length} more`)
  }
  return [header, ...shown].join('\n')
}

/**
 * Matches what each browser engine throws when a dynamically imported chunk fails to load, plus
 * Vite's equivalent for a chunk's CSS. These are caused by the network (the user is offline, or a
 * deploy replaced the chunk) rather than by a bug, so retrying is the fix.
 */
const CHUNK_LOAD_ERROR_PATTERNS = [
  /failed to fetch dynamically imported module/i, // Chromium
  /error loading dynamically imported module/i, // Firefox
  /importing a module script failed/i, // WebKit
  /unable to preload css/i, // Vite
]

function isChunkLoadError(error: Error): boolean {
  return CHUNK_LOAD_ERROR_PATTERNS.some(pattern => pattern.test(error.message))
}

/** Reloads the page once the browser regains a network connection. */
function ReloadWhenOnline() {
  useEffect(() => {
    const onOnline = () => location.reload()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [])
  return null
}

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
    if (isChunkLoadError(error)) {
      logger.warning(`RootErrorBoundary caught a chunk load error: ${describeError(error)}`)
      return
    }
    logger.error(`RootErrorBoundary caught an error: ${describeError(error)}`)
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
              {IS_ELECTRON ? <SystemBarPlaceholder /> : undefined}
            </>
          ) : undefined}
          <Container>
            <ContentsErrorBoundary rootError={error} />
          </Container>
          {isChunkLoadError(error) ? <ReloadWhenOnline /> : undefined}
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

    if (isChunkLoadError(rootError)) {
      // Nothing is broken, so retry the same page rather than resetting to the root
      return hasTranslationError ? (
        <StaticChunkLoadErrorContents onRetryClick={this.retry} />
      ) : (
        <TranslatedChunkLoadErrorContents onRetryClick={this.retry} />
      )
    }

    return hasTranslationError ? (
      <StaticErrorContents
        rootError={rootError}
        onReloadAppClick={this.reloadApp}
        onReportBugClick={IS_ELECTRON ? this.reportBug : undefined}
      />
    ) : (
      <TranslatedErrorContents
        rootError={rootError}
        onReloadAppClick={this.reloadApp}
        onReportBugClick={IS_ELECTRON ? this.reportBug : undefined}
      />
    )
  }

  retry = () => {
    location.reload()
  }

  reloadApp = () => {
    if (location.pathname === '/') {
      location.reload()
    } else {
      // Put them back at the root of the app in case the place they were was causing errors
      location.pathname = '/'
    }
  }

  /**
   * Reloads the app before showing the bug report dialog, since the app's state can't be trusted
   * to show a dialog after an error made it here. The report still carries the error, as it was
   * written to the logs that get uploaded with it.
   */
  reportBug = () => {
    requestBugReportOnNextLoad()
    this.reloadApp()
  }
}

interface ErrorContentsProps {
  rootError: Error
  onReloadAppClick?: () => void
  /** Reloads the app and then opens the bug report dialog. Omitted where there are no logs to send. */
  onReportBugClick?: () => void
}

function TranslatedErrorContents({
  rootError,
  onReloadAppClick,
  onReportBugClick,
}: ErrorContentsProps) {
  const { t } = useTranslation()

  return (
    <>
      <TitleLarge>{t('rootErrorBoundary.title', 'Something went wrong :(')}</TitleLarge>
      <ErrorInfo>{describeError(rootError, MAX_DISPLAYED_FRAMES)}</ErrorInfo>
      <Instructions>
        <Trans t={t} i18nKey='rootErrorBoundary.contents'>
          Please report this issue to us in our{' '}
          <a href={DISCORD_URL} title='Discord' target='_blank' rel='noopener'>
            Discord
          </a>
          .
        </Trans>
      </Instructions>
      <Actions>
        <FilledButton
          label={t('rootErrorBoundary.reloadApp', 'Reload app')}
          onClick={onReloadAppClick}
        />
        {onReportBugClick ? (
          <OutlinedButton
            label={t('rootErrorBoundary.reportBug', 'Report a bug')}
            onClick={onReportBugClick}
          />
        ) : undefined}
      </Actions>
    </>
  )
}

function StaticErrorContents({
  rootError,
  onReloadAppClick,
  onReportBugClick,
}: ErrorContentsProps) {
  return (
    <>
      <TitleLarge>Something went wrong :(</TitleLarge>
      <ErrorInfo>{describeError(rootError, MAX_DISPLAYED_FRAMES)}</ErrorInfo>
      <Instructions>
        Please report this issue to us in our{' '}
        <a href={DISCORD_URL} title='Discord' target='_blank' rel='noopener'>
          Discord
        </a>
        .
      </Instructions>
      <Actions>
        <FilledButton label='Reload app' onClick={onReloadAppClick} />
        {onReportBugClick ? (
          <OutlinedButton label='Report a bug' onClick={onReportBugClick} />
        ) : undefined}
      </Actions>
    </>
  )
}

interface ChunkLoadErrorContentsProps {
  onRetryClick: () => void
}

function TranslatedChunkLoadErrorContents({ onRetryClick }: ChunkLoadErrorContentsProps) {
  const { t } = useTranslation()

  return (
    <>
      <TitleLarge>{t('rootErrorBoundary.loadFailedTitle', "Couldn't load this page")}</TitleLarge>
      <Instructions>
        {t('rootErrorBoundary.loadFailedContents', 'Check your internet connection and try again.')}
      </Instructions>
      <Actions>
        <FilledButton label={t('rootErrorBoundary.tryAgain', 'Try again')} onClick={onRetryClick} />
      </Actions>
    </>
  )
}

function StaticChunkLoadErrorContents({ onRetryClick }: ChunkLoadErrorContentsProps) {
  return (
    <>
      <TitleLarge>Couldn't load this page</TitleLarge>
      <Instructions>Check your internet connection and try again.</Instructions>
      <Actions>
        <FilledButton label='Try again' onClick={onRetryClick} />
      </Actions>
    </>
  )
}
