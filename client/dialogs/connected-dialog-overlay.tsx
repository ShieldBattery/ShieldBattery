import { Immutable } from 'immer'
import { AnimatePresence, Transition, Variants } from 'motion/react'
import * as m from 'motion/react-m'
import React, { useState } from 'react'
import ReactDOM from 'react-dom'
import styled from 'styled-components'
import { LaunchingGameDialog } from '../active-game/launching-game-dialog'
import { EmailVerificationDialog } from '../auth/email-verification-dialog'
import { BugReportDialog } from '../bugs/bug-report-dialog'
import { ChannelBanUserDialog } from '../chat/channel-ban-user-dialog'
import { ChannelSettingsDialog } from '../chat/channel-settings-dialog'
import { FocusTrap } from '../dom/focus-trap'
import { useExternalElementRef } from '../dom/use-external-element-ref'
import DownloadDialog from '../download/download-dialog'
import { KeyListenerBoundary } from '../keyboard/key-listener'
import { LeagueExplainerDialog } from '../leagues/league-explainer'
import MapDetailsDialog from '../maps/map-details'
import { MapDownloadDialog } from '../maps/map-download-dialog'
import { MapPreviewDialog } from '../maps/map-preview'
import { AcceptMatchDialog, FailedToAcceptMatchDialog } from '../matchmaking/accept-match-dialog'
import { MatchmakingBannedDialog } from '../matchmaking/matchmaking-banned-dialog'
import { PostMatchDialog } from '../matchmaking/post-match-dialog'
import { DialogContext } from '../material/dialog'
import { isHandledDismissalEvent } from '../material/dismissal-events'
import { zIndexDialogScrim } from '../material/zindex'
import { ExternalLinkDialog } from '../navigation/external-link-dialog'
import {
  AcceptableUseDialog,
  PrivacyPolicyDialog,
  TermsOfServiceDialog,
} from '../policies/policy-displays'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { ReplayInfoDialog } from '../replays/replay-info-display'
import { ReplayLoadDialog } from '../replays/replay-load-dialog'
import { ChangeEmailDialog, ChangePasswordDialog } from '../settings/user/account-settings'
import { ShieldBatteryHealthDialog } from '../starcraft/shieldbattery-health'
import { StarcraftHealthCheckupDialog } from '../starcraft/starcraft-health'
import { dialogScrimOpacity } from '../styles/colors'
import { CreateWhisper as CreateWhisperSessionDialog } from '../whispers/create-whisper'
import { closeDialogById } from './action-creators'
import { DialogState } from './dialog-reducer'
import { DialogType } from './dialog-type'
import { MarkdownDialog } from './markdown-dialog'
import { SimpleDialog } from './simple-dialog'

const Scrim = styled(m.div)`
  position: fixed;
  left: 0;
  top: var(--sb-system-bar-height, 0);
  right: 0;
  bottom: 0;

  background: var(--theme-dialog-scrim);
  z-index: ${zIndexDialogScrim};

  -webkit-app-region: no-drag;
`

const noop = () => {}

function getDialog(dialogType: DialogType): {
  component: React.ComponentType<any>
  modal?: boolean
} {
  switch (dialogType) {
    case DialogType.AcceptMatch:
      return { component: AcceptMatchDialog, modal: true }
    case DialogType.AcceptableUse:
      return { component: AcceptableUseDialog }
    case DialogType.BugReport:
      return { component: BugReportDialog }
    case DialogType.ChangeEmail:
      return { component: ChangeEmailDialog }
    case DialogType.ChangePassword:
      return { component: ChangePasswordDialog }
    case DialogType.ChannelBanUser:
      return { component: ChannelBanUserDialog }
    case DialogType.ChannelSettings:
      return { component: ChannelSettingsDialog, modal: true }
    case DialogType.Download:
      return { component: DownloadDialog }
    case DialogType.EmailVerification:
      return { component: EmailVerificationDialog }
    case DialogType.ExternalLink:
      return { component: ExternalLinkDialog }
    case DialogType.FailedToAcceptMatch:
      return { component: FailedToAcceptMatchDialog }
    case DialogType.LaunchingGame:
      return { component: LaunchingGameDialog, modal: true }
    case DialogType.LeagueExplainer:
      return { component: LeagueExplainerDialog }
    case DialogType.MapDetails:
      return { component: MapDetailsDialog }
    case DialogType.MapDownload:
      return { component: MapDownloadDialog, modal: true }
    case DialogType.MapPreview:
      return { component: MapPreviewDialog }
    case DialogType.Markdown:
      return { component: MarkdownDialog }
    case DialogType.MatchmakingBanned:
      return { component: MatchmakingBannedDialog }
    case DialogType.PostMatch:
      return { component: PostMatchDialog }
    case DialogType.PrivacyPolicy:
      return { component: PrivacyPolicyDialog }
    case DialogType.ReplayInfo:
      return { component: ReplayInfoDialog }
    case DialogType.ReplayLoad:
      return { component: ReplayLoadDialog, modal: true }
    case DialogType.Simple:
      return { component: SimpleDialog }
    case DialogType.ShieldBatteryHealth:
      return { component: ShieldBatteryHealthDialog }
    case DialogType.StarcraftHealth:
      return { component: StarcraftHealthCheckupDialog }
    case DialogType.TermsOfService:
      return { component: TermsOfServiceDialog }
    case DialogType.Whispers:
      return { component: CreateWhisperSessionDialog }
    default:
      return dialogType satisfies never
  }
}

export const ConnectedDialogOverlay = () => {
  const dispatch = useAppDispatch()
  const dialogHistory = useAppSelector(s => s.dialog.history)
  const portalRef = useExternalElementRef()

  return ReactDOM.createPortal(
    <DialogOverlayContent
      dialogHistory={dialogHistory}
      onCancel={(id, event) => {
        if (!event || !isHandledDismissalEvent(event.nativeEvent)) {
          dispatch(closeDialogById(id))
        }
      }}
    />,
    portalRef.current,
  )
}
function DialogOverlayContent({
  dialogHistory,
  onCancel,
}: {
  dialogHistory: Immutable<DialogState[]>
  onCancel: (id: string, event?: React.MouseEvent) => void
}) {
  return (
    <AnimatePresence>
      {dialogHistory.map((dialogState, index) => (
        <DialogDisplay
          key={dialogState.id}
          dialogState={dialogState}
          isTopDialog={dialogHistory.length - 1 === index}
          onCancel={onCancel}
        />
      ))}
    </AnimatePresence>
  )
}

const scrimVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: dialogScrimOpacity },
  exit: { opacity: 0 },
}

const scrimTransition: Transition = {
  opacity: { type: 'spring', duration: 0.3, bounce: 0 },
}

function DialogDisplay({
  dialogState,
  isTopDialog,
  onCancel,
}: {
  dialogState: Immutable<DialogState>
  isTopDialog: boolean
  onCancel: (id: string, event?: React.MouseEvent) => void
}) {
  const { type: dialogType, id } = dialogState
  const { component: DialogComponent, modal } = getDialog(dialogType)

  const [focusableElem, setFocusableElem] = useState<HTMLSpanElement | null>(null)

  return (
    <>
      <AnimatePresence propagate={true}>
        {isTopDialog && (
          <Scrim
            key='scrim'
            variants={scrimVariants}
            initial='initial'
            animate='animate'
            exit='exit'
            transition={scrimTransition}
            onClick={modal ? noop : event => onCancel(id, event)}
          />
        )}
      </AnimatePresence>

      <KeyListenerBoundary active={isTopDialog} key='dialog-content'>
        <FocusTrap focusableElem={focusableElem} focusOnMount={isTopDialog}>
          <span ref={setFocusableElem} tabIndex={-1}>
            <DialogContext.Provider value={{ isTopDialog }}>
              <DialogComponent
                key={dialogState.id}
                onCancel={modal ? noop : (event?: React.MouseEvent) => onCancel(id, event)}
                close={() => onCancel(id)}
                {...dialogState.initData}
              />
            </DialogContext.Provider>
          </span>
        </FocusTrap>
      </KeyListenerBoundary>
    </>
  )
}
