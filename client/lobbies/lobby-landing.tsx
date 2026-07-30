import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { makeSbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { MaterialIcon } from '../icons/material/material-icon'
import { FilledButton } from '../material/button'
import { LinkButton } from '../material/link-button'
import { LoadingDotsArea } from '../progress/dots'
import { CenteredContentContainer } from '../styles/centered-container'
import { BodyLarge, BodyMedium } from '../styles/typography'
import { LobbySummaryDetails, LobbySummaryLoadState, useLobbySummary } from './lobby-summary'
import { useCorrectLobbySlug } from './lobby-url'

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

/**
 * The presentational part of {@link LobbyLandingPage}: renders the loading/notFound/error/loaded
 * states without doing any fetching itself, so it can be driven directly (e.g. from a devonly test
 * page) without racing a real lobby.
 */
export function LobbyLandingContent({ state }: { state: LobbySummaryLoadState | undefined }) {
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
          <>
            <LobbySummaryDetails summary={state.data} />
            <DownloadCta showAppHint={true} />
          </>
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
      <LinkButton href='/download'>
        <FilledButton
          styledAs='div'
          label={t('lobbies.landing.download', 'Download ShieldBattery')}
          iconStart={<MaterialIcon icon='download' />}
        />
      </LinkButton>
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
