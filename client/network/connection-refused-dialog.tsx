import { Trans, useTranslation } from 'react-i18next'
import { SiteConnectionRefusal } from '../../common/websockets'
import { closeDialogById, openSimpleDialog } from '../dialogs/action-creators'
import { dispatch } from '../dispatch-registry'
import {
  addChangeHandler,
  getUpdateState,
  removeChangeHandler,
  UpdateState,
} from '../download/updater-state'
import i18n from '../i18n/i18next'
import { BodyLarge } from '../styles/typography'
import { makeServerUrl } from './server-url'

/** How long the updater gets to find an update before we explain the refusal ourselves. */
export const UPDATE_FALLBACK_DELAY_MS = 15_000

let openDialogId: string | undefined
let fallbackTimeout: ReturnType<typeof setTimeout> | undefined

function onUpdateState(state: UpdateState) {
  // The update dialog takes over once an update turns up
  if (state.hasUpdate) {
    dismissConnectionRefused()
  }
}

function DownloadLink({ children }: { children?: React.ReactNode }) {
  return (
    <a href={makeServerUrl('/download')} target='_blank' rel='noopener noreferrer'>
      {children}
    </a>
  )
}

function ClientVerificationFailedContent() {
  const { t } = useTranslation()

  return (
    <BodyLarge>
      <Trans t={t} i18nKey='network.clientVerification.failedContents'>
        This copy of ShieldBattery couldn't be verified, so it can't connect. Please download the
        latest version from <DownloadLink>our website</DownloadLink> and reinstall it.
      </Trans>
    </BodyLarge>
  )
}

function ClientUpdateRequiredContent() {
  const { t } = useTranslation()

  return (
    <BodyLarge>
      <Trans t={t} i18nKey='network.clientUpdate.requiredContents'>
        This version of ShieldBattery is out of date, so it can't connect. Please download the
        latest version from <DownloadLink>our website</DownloadLink>.
      </Trans>
    </BodyLarge>
  )
}

function open(title: string, content: React.ReactNode) {
  dismissConnectionRefused()
  const action = openSimpleDialog(title, content)
  openDialogId = action.meta.id
  dispatch(action)
}

/** Explains why the server refused this client. */
export function showConnectionRefused(refusal: SiteConnectionRefusal) {
  if (refusal === 'clientVerification') {
    open(
      i18n.t('network.clientVerification.failedTitle', "Couldn't verify ShieldBattery"),
      <ClientVerificationFailedContent />,
    )
    return
  }

  // Normally the update dialog explains this, so only step in if the updater doesn't find anything
  dismissConnectionRefused()
  fallbackTimeout = setTimeout(() => {
    fallbackTimeout = undefined
    if (!getUpdateState().hasUpdate) {
      open(
        i18n.t('network.clientUpdate.requiredTitle', 'Update required'),
        <ClientUpdateRequiredContent />,
      )
      addChangeHandler(onUpdateState)
    }
  }, UPDATE_FALLBACK_DELAY_MS)
}

/** Closes (or cancels) any explanation of a refusal, e.g. because the user has logged out. */
export function dismissConnectionRefused() {
  removeChangeHandler(onUpdateState)
  if (fallbackTimeout) {
    clearTimeout(fallbackTimeout)
    fallbackTimeout = undefined
  }
  if (openDialogId) {
    dispatch(closeDialogById(openDialogId))
    openDialogId = undefined
  }
}
