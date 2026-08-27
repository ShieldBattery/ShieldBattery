import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Link } from 'wouter'
import { assertUnreachable } from '../../common/assert-unreachable'
import { formatJoinCode } from '../../common/lobbies/join-code'
import { LobbySummaryResponse } from '../../common/lobbies/lobby-network'
import { urlForLobby } from '../../common/lobbies/lobby-url'
import { makeSbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { MaterialIcon } from '../icons/material/material-icon'
import logger from '../logging/logger'
import { FilledButton, IconButton } from '../material/button'
import { LinkButton } from '../material/link-button'
import { LoadingDotsArea } from '../progress/dots'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { CenteredContentContainer } from '../styles/centered-container'
import {
  BodyLarge,
  bodyMedium,
  BodyMedium,
  displaySmall,
  labelMedium,
  TitleMedium,
} from '../styles/typography'
import { LobbySummaryDetails, LobbySummaryLoadState, useLobbySummary } from './lobby-summary'
import { useCorrectLobbySlug } from './lobby-url'

/** How long to wait for a `blur`/`visibilitychange` signal before treating a launch as failed. */
const LAUNCH_DETECTION_TIMEOUT_MS = 2500

/**
 * The open-in-app launch flow's state: `idle` (not yet attempted), `opening` (the scheme URL was
 * just fired and detection is watching for a blur/hide signal), or `failed` (the detection window
 * elapsed with no signal, meaning nothing on this computer handled the link).
 */
export type LaunchFlowState = 'idle' | 'opening' | 'failed'

const Root = styled(CenteredContentContainer)`
  padding-block: 48px 24px;
`

const StateMessageLayout = styled.div`
  width: 100%;
  padding: 48px 16px;

  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;

  text-align: center;
`

const StateMessageIcon = styled(MaterialIcon).attrs({ size: 96, filled: false })`
  color: var(--theme-on-surface-variant);
`

const CtaLayout = styled.div`
  margin-top: 40px;

  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
`

const AppHint = styled(BodyMedium)`
  max-width: 480px;
  color: var(--theme-on-surface-variant);
  text-align: center;
`

/** Hidden on touch devices with no hover capability: firing a desktop protocol scheme there does
 * nothing useful, so the whole open-in-app affordance (button and detection states alike) gives
 * way to the join code. */
const OpenInAppContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;

  @media (hover: none) and (pointer: coarse) {
    display: none;
  }
`

const StatusLine = styled(TitleMedium)`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  text-align: center;
`

const OpeningIcon = styled(MaterialIcon).attrs({ icon: 'open_in_new', size: 22 })`
  color: var(--color-blue80);
  flex-shrink: 0;
`

/** A button that reads as inline link text (matching the global `a` styling), for actions embedded
 * in a sentence that trigger something in JavaScript rather than navigating anywhere. */
const InlineActionButton = styled.button.attrs({ type: 'button' })`
  ${bodyMedium};
  display: inline;
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  color: var(--color-amber70);
  cursor: pointer;

  &:hover,
  &:active {
    color: var(--color-amber80);
    text-decoration: underline;
  }
`

const CodePanelRoot = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;

  max-width: 100%;
  box-sizing: border-box;
  padding: 16px 32px 14px;

  background-color: var(--theme-container-low);
  border: 1px solid var(--color-grey-blue40);
  border-radius: 6px;
`

const CodeLabelBase = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
  text-align: center;
  text-transform: uppercase;
  letter-spacing: 1.2px;
`

/** Shown everywhere except touch devices with no hover capability; see `MobileCodeLabel`. */
const DesktopCodeLabel = styled(CodeLabelBase)`
  @media (hover: none) and (pointer: coarse) {
    display: none;
  }
`

/** The code panel's label on touch devices with no hover capability, swapped in for
 * `DesktopCodeLabel` by the same media query so the copy leads with the phone-to-PC flow instead
 * of a button that would do nothing there. */
const MobileCodeLabel = styled(CodeLabelBase)`
  display: none;

  @media (hover: none) and (pointer: coarse) {
    display: block;
  }
`

const CodeRow = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`

const CodeValue = styled.div`
  ${displaySmall};
  letter-spacing: 6px;
  color: var(--theme-amber);
`

const CopyCodeButton = styled(IconButton)`
  width: 32px;
  min-height: 32px;

  &:hover {
    color: var(--theme-amber);
  }
`

export interface LobbyLandingPageProps {
  params: { lobbyId: string }
}

/**
 * A logged-out web landing page for a lobby link (`/lobbies/<id>/<name-slug>`). Electron renders
 * the real lobby (`LobbyView`) at this route instead -- this page exists purely so that sharing a
 * lobby link outside the app (e.g. in a browser) shows something useful rather than a blank route.
 * Lobbies are ephemeral, so a dead link (404 from the summary endpoint) is an expected, first-class
 * outcome here, not an error case.
 */
export function LobbyLandingPage({ params }: LobbyLandingPageProps) {
  const lobbyId = makeSbLobbyId(params.lobbyId)
  const [state] = useLobbySummary(lobbyId)

  const lobbyName = state?.status === 'loaded' ? state.data.summary.name : undefined
  useCorrectLobbySlug(lobbyId, lobbyName)

  return <LobbyLandingContent state={state} />
}

export interface LobbyLandingContentProps {
  state: LobbySummaryLoadState | undefined
  /**
   * Forces the open-in-app launch flow to a specific state instead of driving it from real
   * blur/visibility detection. Devonly test harness hook only; omit to drive it for real.
   */
  forceLaunchState?: LaunchFlowState
  /**
   * Forces whether a deep-link scheme is treated as configured, overriding the real
   * `window.SB_DEEP_LINK_SCHEME`. Devonly test harness hook only; omit to read the real global.
   */
  forceSchemeAvailable?: boolean
}

/**
 * The presentational part of {@link LobbyLandingPage}: renders the loading/notFound/error/loaded
 * states without doing any fetching itself, so it can be driven directly (e.g. from a devonly test
 * page) without racing a real lobby.
 */
export function LobbyLandingContent({
  state,
  forceLaunchState,
  forceSchemeAvailable,
}: LobbyLandingContentProps) {
  let content: React.ReactNode
  if (!state) {
    content = <LoadingDotsArea />
  } else {
    switch (state.status) {
      case 'notFound':
        content = <NotFoundState />
        break
      case 'error':
        content = <ErrorState />
        break
      case 'loaded':
        content = (
          <LoadedState
            data={state.data}
            forceLaunchState={forceLaunchState}
            forceSchemeAvailable={forceSchemeAvailable}
          />
        )
        break
      default:
        content = assertUnreachable(state)
    }
  }

  return <Root $targetWidth={720}>{content}</Root>
}

function NotFoundState() {
  const { t } = useTranslation()

  return (
    <StateMessageLayout>
      <StateMessageIcon icon='other_houses' />
      <BodyLarge>{t('lobbies.summary.noLongerOpen', 'This lobby is no longer open.')}</BodyLarge>
      <DownloadCta />
    </StateMessageLayout>
  )
}

function ErrorState() {
  const { t } = useTranslation()

  return (
    <StateMessageLayout>
      <StateMessageIcon icon='cloud_off' />
      <BodyLarge>
        {t('lobbies.landing.loadError', 'There was a problem loading this lobby.')}
      </BodyLarge>
      <DownloadCta />
    </StateMessageLayout>
  )
}

function DownloadCta({ showAppHint = false }: { showAppHint?: boolean }) {
  const { t } = useTranslation()

  return (
    <CtaLayout>
      <DownloadButton />
      {showAppHint ? (
        <AppHint>
          {t(
            'lobbies.landing.openInApp',
            'Already have ShieldBattery? Open this link from inside the app to join the lobby.',
          )}
        </AppHint>
      ) : null}
    </CtaLayout>
  )
}

function DownloadButton() {
  const { t } = useTranslation()

  return (
    <LinkButton href='/download'>
      <FilledButton
        styledAs='div'
        label={t('lobbies.landing.download', 'Download ShieldBattery')}
        iconStart={<MaterialIcon icon='download' />}
      />
    </LinkButton>
  )
}

/**
 * Resolves the deep-link scheme the desktop app registered for this deployment, or undefined when
 * none is configured (local dev, where the open-in-app affordance is off by design).
 *
 * `forceAvailable`, when set, overrides the real `window.SB_DEEP_LINK_SCHEME`: `false` forces it
 * absent, `true` forces it present (falling back to a placeholder scheme if the real global isn't
 * set). Used by the devonly test harness; omit to read the real global.
 */
function resolveDeepLinkScheme(forceAvailable: boolean | undefined): string | undefined {
  if (forceAvailable === false) {
    return undefined
  }
  if (forceAvailable === true) {
    return window.SB_DEEP_LINK_SCHEME ?? 'shieldbattery'
  }
  return window.SB_DEEP_LINK_SCHEME
}

/**
 * Drives the open-in-app launch-detection flow: firing the deep link enters `opening` and starts
 * watching for a `blur`/`visibilitychange` signal. A signal within the detection window is an
 * ambiguous positive (the app launched, or the browser only showed its own protocol confirmation
 * prompt), so the flow stays in `opening` but flips `fallbackHintVisible` so the caller can offer a
 * way out; no signal at all within the window means nothing on this computer handled the link, and
 * the flow moves to `failed`. Every call to `launch` re-arms detection from scratch, so retrying
 * from either the soft-opening or failed state works the same as the first attempt.
 *
 * `forcedState`, when set, freezes the returned state and skips all detection wiring -- the
 * devonly test harness uses this to render each state without a real app install.
 */
function useLaunchFlow(
  launchUrl: string | undefined,
  forcedState?: LaunchFlowState,
): { launchState: LaunchFlowState; fallbackHintVisible: boolean; launch: () => void } {
  const [launchState, setLaunchState] = useState<LaunchFlowState>('idle')
  const [fallbackHintVisible, setFallbackHintVisible] = useState(false)
  const [attempt, setAttempt] = useState(0)

  const launch = () => {
    if (!launchUrl) {
      return
    }
    // Must happen synchronously inside the click handler -- browsers ignore external-protocol
    // navigation that isn't directly tied to a user gesture.
    window.location.href = launchUrl
    setFallbackHintVisible(false)
    setLaunchState('opening')
    setAttempt(a => a + 1)
  }

  useEffect(() => {
    if (forcedState !== undefined || launchState !== 'opening') {
      return () => {}
    }

    let signaled = false
    const onSignal = () => {
      signaled = true
      setFallbackHintVisible(true)
    }
    window.addEventListener('blur', onSignal)
    document.addEventListener('visibilitychange', onSignal)

    const timeoutId = setTimeout(() => {
      if (!signaled) {
        setLaunchState('failed')
      }
    }, LAUNCH_DETECTION_TIMEOUT_MS)

    return () => {
      window.removeEventListener('blur', onSignal)
      document.removeEventListener('visibilitychange', onSignal)
      clearTimeout(timeoutId)
    }
    // `attempt` is unused in the body but re-arms this effect on a retry fired while already in
    // the `opening` phase, where `launchState` alone wouldn't change.
  }, [forcedState, launchState, attempt])

  if (forcedState !== undefined) {
    return { launchState: forcedState, fallbackHintVisible: forcedState === 'opening', launch }
  }

  return { launchState, fallbackHintVisible, launch }
}

function LoadedState({
  data,
  forceLaunchState,
  forceSchemeAvailable,
}: {
  data: LobbySummaryResponse
  forceLaunchState?: LaunchFlowState
  forceSchemeAvailable?: boolean
}) {
  const { t } = useTranslation()
  const scheme = resolveDeepLinkScheme(forceSchemeAvailable)
  const launchUrl = scheme
    ? `${scheme}:/${urlForLobby(data.summary.id, data.summary.name)}`
    : undefined
  const { launchState, fallbackHintVisible, launch } = useLaunchFlow(launchUrl, forceLaunchState)
  const formattedCode = data.joinCode ? formatJoinCode(data.joinCode) : undefined

  // Launching replaces the focused button with status text, which would silently drop keyboard
  // focus to the body and leave screen readers unaware anything happened. The container is a live
  // status region and takes focus itself across those transitions, so the announcement lands and
  // tabbing continues from the launch area (next stop: the download/retry affordances).
  const openInAppRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (launchState !== 'idle') {
      openInAppRef.current?.focus()
    }
  }, [launchState])

  return (
    <>
      <LobbySummaryDetails summary={data} />
      <CtaLayout>
        {scheme ? (
          <OpenInAppContainer ref={openInAppRef} tabIndex={-1} role='status'>
            <OpenInAppPrimaryArea launchState={launchState} onLaunch={launch} />
          </OpenInAppContainer>
        ) : null}
        {formattedCode ? (
          <CodePanel code={formattedCode} afterFailedLaunch={launchState === 'failed'} />
        ) : null}
        {scheme ? (
          <LaunchFollowupHint
            launchState={launchState}
            fallbackHintVisible={fallbackHintVisible}
            onRetry={launch}
          />
        ) : null}
        <AppHint>
          <Trans t={t} i18nKey='lobbies.landing.downloadHint'>
            Don't have ShieldBattery yet? <Link href='/download'>Download it for free</Link>
          </Trans>
        </AppHint>
      </CtaLayout>
    </>
  )
}

/** The button or status line at the top of the CTA area, driven by the launch flow's state. */
function OpenInAppPrimaryArea({
  launchState,
  onLaunch,
}: {
  launchState: LaunchFlowState
  onLaunch: () => void
}) {
  const { t } = useTranslation()

  switch (launchState) {
    case 'idle':
      return (
        <FilledButton
          label={t('lobbies.landing.appLaunch.button', 'Open in the ShieldBattery app')}
          iconStart={<MaterialIcon icon='open_in_new' size={20} />}
          onClick={onLaunch}
        />
      )
    case 'opening':
      return (
        <StatusLine>
          <OpeningIcon />
          {t('lobbies.landing.appLaunch.opening', 'Opening in the ShieldBattery app…')}
        </StatusLine>
      )
    case 'failed':
      return (
        <>
          <StatusLine>
            {t('lobbies.landing.appLaunch.failedTitle', "The app didn't open.")}
          </StatusLine>
          <AppHint>
            {t(
              'lobbies.landing.appLaunch.failedSubtitle',
              'It might not be installed on this computer.',
            )}
          </AppHint>
          <DownloadButton />
        </>
      )
    default:
      return assertUnreachable(launchState)
  }
}

/**
 * The dynamic hint shown below the join-code panel: the soft-opening fallback (once a
 * blur/visibility signal has been seen) or the failed-state retry link. Renders nothing in every
 * other state.
 */
function LaunchFollowupHint({
  launchState,
  fallbackHintVisible,
  onRetry,
}: {
  launchState: LaunchFlowState
  fallbackHintVisible: boolean
  onRetry: () => void
}) {
  const { t } = useTranslation()

  if (launchState === 'opening' && fallbackHintVisible) {
    return (
      <AppHint>
        <Trans t={t} i18nKey='lobbies.landing.appLaunch.fallbackHint'>
          Nothing happening? <InlineActionButton onClick={onRetry}>Try again</InlineActionButton> or{' '}
          <Link href='/download'>download the app</Link>
        </Trans>
      </AppHint>
    )
  }

  if (launchState === 'failed') {
    return (
      <AppHint>
        <InlineActionButton onClick={onRetry}>
          {t('lobbies.landing.appLaunch.retryAfterFailure', 'Try opening the app again')}
        </InlineActionButton>
      </AppHint>
    )
  }

  return null
}

function CodePanel({ code, afterFailedLaunch }: { code: string; afterFailedLaunch: boolean }) {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()

  const handleCopy = () => {
    navigator.clipboard
      .writeText(code)
      .then(() => {
        snackbarController.showSnackbar(t('lobbies.landing.joinCode.copied', 'Copied to clipboard'))
      })
      .catch(err => logger.error('Error writing join code to clipboard: ' + (err?.stack ?? err)))
  }

  return (
    <CodePanelRoot>
      <DesktopCodeLabel>
        {afterFailedLaunch
          ? t('lobbies.landing.joinCode.labelAfterFailure', 'Already have the app? Enter this code')
          : t('lobbies.landing.joinCode.label', 'Or enter this code in the app')}
      </DesktopCodeLabel>
      <MobileCodeLabel>
        {t(
          'lobbies.landing.joinCode.labelMobile',
          'On your PC? Open ShieldBattery and enter this code',
        )}
      </MobileCodeLabel>
      <CodeRow>
        <CodeValue>{code}</CodeValue>
        <CopyCodeButton
          icon={<MaterialIcon icon='content_copy' size={18} />}
          onClick={handleCopy}
          ariaLabel={t('lobbies.landing.joinCode.copy', 'Copy code')}
        />
      </CodeRow>
    </CodePanelRoot>
  )
}
