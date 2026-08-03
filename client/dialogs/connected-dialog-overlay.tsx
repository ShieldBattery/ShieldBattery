import { Immutable } from 'immer'
import { AnimatePresence, Transition, Variants } from 'motion/react'
import * as m from 'motion/react-m'
import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import styled from 'styled-components'
import { useIsDocumentVisible } from '../dom/document-visibility'
import { FocusTrap } from '../dom/focus-trap'
import { useExternalElement } from '../dom/use-external-element-ref'
import { KeyListenerBoundary } from '../keyboard/key-listener'
import { DialogContext } from '../material/dialog'
import { isHandledDismissalEvent } from '../material/dismissal-events'
import { zIndexDialogScrim } from '../material/zindex'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { dialogScrimOpacity } from '../styles/colors'
import { closeDialogById } from './action-creators'
import { DialogState } from './dialog-reducer'
import { DialogType } from './dialog-type'
import { MarkdownDialog } from './markdown-dialog'
import { SimpleDialog } from './simple-dialog'

const LaunchingGameDialog = React.lazy(async () => ({
  default: (await import('../active-game/launching-game-dialog')).LaunchingGameDialog,
}))
const EmailVerificationDialog = React.lazy(async () => ({
  default: (await import('../auth/email-verification-dialog')).EmailVerificationDialog,
}))
const BugReportDialog = React.lazy(async () => ({
  default: (await import('../bugs/bug-report-dialog')).BugReportDialog,
}))
const AdminDeleteChatMessageDialog = React.lazy(async () => ({
  default: (await import('../chat/admin/delete-message-dialog')).AdminDeleteChatMessageDialog,
}))
const ChannelBanUserDialog = React.lazy(async () => ({
  default: (await import('../chat/channel-ban-user-dialog')).ChannelBanUserDialog,
}))
const ChannelKickUserConfirmation = React.lazy(async () => ({
  default: (await import('../chat/channel-kick-user-dialog')).ChannelKickUserConfirmation,
}))
const ChannelLeaveConfirmation = React.lazy(async () => ({
  default: (await import('../chat/channel-leave-dialog')).ChannelLeaveConfirmation,
}))
const ChannelUserPermissionsDialog = React.lazy(async () => ({
  default: (await import('../chat/channel-settings/user-permissions-settings'))
    .ChannelUserPermissionsDialog,
}))
const ChannelTransferOwnershipDialog = React.lazy(async () => ({
  default: (await import('../chat/channel-transfer-ownership-dialog'))
    .ChannelTransferOwnershipDialog,
}))
const ChannelUnbanUserConfirmation = React.lazy(async () => ({
  default: (await import('../chat/channel-unban-user-dialog')).ChannelUnbanUserConfirmation,
}))
const DownloadDialog = React.lazy(() => import('../download/download-dialog'))
const ReportGameDialog = React.lazy(async () => ({
  default: (await import('../games/report-game-dialog')).ReportGameDialog,
}))
const LeagueExplainerDialog = React.lazy(async () => ({
  default: (await import('../leagues/league-explainer')).LeagueExplainerDialog,
}))
const LobbyMoveSlotDialog = React.lazy(async () => ({
  default: (await import('../lobbies/lobby-move-slot-dialog')).LobbyMoveSlotDialog,
}))
const LobbySettingsDialog = React.lazy(async () => ({
  default: (await import('../lobbies/lobby-settings-dialog')).LobbySettingsDialog,
}))
const MapDetailsDialog = React.lazy(() => import('../maps/map-details'))
const MapDownloadDialog = React.lazy(async () => ({
  default: (await import('../maps/map-download-dialog')).MapDownloadDialog,
}))
const MapPreviewDialog = React.lazy(async () => ({
  default: (await import('../maps/map-preview')).MapPreviewDialog,
}))
const SelectMapDialog = React.lazy(async () => ({
  default: (await import('../maps/select-map-dialog')).SelectMapDialog,
}))
const AcceptMatchDialog = React.lazy(async () => ({
  default: (await import('../matchmaking/accept-match-dialog')).AcceptMatchDialog,
}))
const FailedToAcceptMatchDialog = React.lazy(async () => ({
  default: (await import('../matchmaking/accept-match-dialog')).FailedToAcceptMatchDialog,
}))
const MatchmakingBannedDialog = React.lazy(async () => ({
  default: (await import('../matchmaking/matchmaking-banned-dialog')).MatchmakingBannedDialog,
}))
const PostMatchDialog = React.lazy(async () => ({
  default: (await import('../matchmaking/post-match-dialog')).PostMatchDialog,
}))
const ExternalLinkDialog = React.lazy(async () => ({
  default: (await import('../navigation/external-link-dialog')).ExternalLinkDialog,
}))
const AcceptableUseDialog = React.lazy(async () => ({
  default: (await import('../policies/policy-displays')).AcceptableUseDialog,
}))
const PrivacyPolicyDialog = React.lazy(async () => ({
  default: (await import('../policies/policy-displays')).PrivacyPolicyDialog,
}))
const TermsOfServiceDialog = React.lazy(async () => ({
  default: (await import('../policies/policy-displays')).TermsOfServiceDialog,
}))
const CreatePlaylistDialog = React.lazy(async () => ({
  default: (await import('../replays/playlist-dialogs')).CreatePlaylistDialog,
}))
const DeletePlaylistDialog = React.lazy(async () => ({
  default: (await import('../replays/playlist-dialogs')).DeletePlaylistDialog,
}))
const RenamePlaylistDialog = React.lazy(async () => ({
  default: (await import('../replays/playlist-dialogs')).RenamePlaylistDialog,
}))
const ReplayInfoDialog = React.lazy(async () => ({
  default: (await import('../replays/replay-info-display')).ReplayInfoDialog,
}))
const ReplayLoadDialog = React.lazy(async () => ({
  default: (await import('../replays/replay-load-dialog')).ReplayLoadDialog,
}))
const ChangeDisplayNameDialog = React.lazy(async () => ({
  default: (await import('../settings/user/account-settings')).ChangeDisplayNameDialog,
}))
const ChangeEmailDialog = React.lazy(async () => ({
  default: (await import('../settings/user/account-settings')).ChangeEmailDialog,
}))
const ChangeLoginNameDialog = React.lazy(async () => ({
  default: (await import('../settings/user/account-settings')).ChangeLoginNameDialog,
}))
const ChangePasswordDialog = React.lazy(async () => ({
  default: (await import('../settings/user/account-settings')).ChangePasswordDialog,
}))
const ShieldBatteryHealthDialog = React.lazy(async () => ({
  default: (await import('../starcraft/shieldbattery-health')).ShieldBatteryHealthDialog,
}))
const StarcraftHealthCheckupDialog = React.lazy(async () => ({
  default: (await import('../starcraft/starcraft-health')).StarcraftHealthCheckupDialog,
}))
const RemoveUserAvatarDialog = React.lazy(async () => ({
  default: (await import('../users/remove-user-avatar-dialog')).RemoveUserAvatarDialog,
}))
const CreateWhisperSessionDialog = React.lazy(async () => ({
  default: (await import('../whispers/create-whisper')).CreateWhisper,
}))

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
    case DialogType.AdminDeleteChatMessage:
      return { component: AdminDeleteChatMessageDialog }
    case DialogType.BugReport:
      return { component: BugReportDialog }
    case DialogType.ChangeDisplayName:
      return { component: ChangeDisplayNameDialog }
    case DialogType.ChangeEmail:
      return { component: ChangeEmailDialog }
    case DialogType.ChangeLoginName:
      return { component: ChangeLoginNameDialog }
    case DialogType.ChangePassword:
      return { component: ChangePasswordDialog }
    case DialogType.ChannelBanUser:
      return { component: ChannelBanUserDialog }
    case DialogType.ChannelKickUserConfirmation:
      return { component: ChannelKickUserConfirmation }
    case DialogType.ChannelLeaveConfirmation:
      return { component: ChannelLeaveConfirmation }
    case DialogType.ChannelTransferOwnership:
      return { component: ChannelTransferOwnershipDialog }
    case DialogType.ChannelUnbanUser:
      return { component: ChannelUnbanUserConfirmation }
    case DialogType.ChannelUserPermissions:
      return { component: ChannelUserPermissionsDialog }
    case DialogType.CreatePlaylist:
      return { component: CreatePlaylistDialog }
    case DialogType.DeletePlaylist:
      return { component: DeletePlaylistDialog }
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
    case DialogType.LobbySettings:
      return { component: LobbySettingsDialog }
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
    case DialogType.MoveSlot:
      return { component: LobbyMoveSlotDialog }
    case DialogType.PostMatch:
      return { component: PostMatchDialog }
    case DialogType.PrivacyPolicy:
      return { component: PrivacyPolicyDialog }
    case DialogType.RemoveUserAvatar:
      return { component: RemoveUserAvatarDialog }
    case DialogType.RenamePlaylist:
      return { component: RenamePlaylistDialog }
    case DialogType.ReplayInfo:
      return { component: ReplayInfoDialog }
    case DialogType.ReplayLoad:
      return { component: ReplayLoadDialog, modal: true }
    case DialogType.ReportGame:
      return { component: ReportGameDialog }
    case DialogType.SelectMap:
      return { component: SelectMapDialog }
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
  const portalElem = useExternalElement()

  return ReactDOM.createPortal(
    <DialogOverlayContent
      dialogHistory={dialogHistory}
      onCancel={(id, event) => {
        if (!event || !isHandledDismissalEvent(event.nativeEvent)) {
          dispatch(closeDialogById(id))
        }
      }}
    />,
    portalElem,
  )
}
function DialogOverlayContent({
  dialogHistory,
  onCancel,
}: {
  dialogHistory: Immutable<DialogState[]>
  onCancel: (id: string, event?: React.MouseEvent) => void
}) {
  // Dialogs removed from history stay mounted until their exit animation completes, but animation
  // frames stop entirely while the document is hidden (window minimized/fully occluded). If the
  // document becomes hidden while an exit is in flight, that animation would never finish and the
  // dialog (and its scrim) would stay on screen indefinitely. Track in-flight exits and, when the
  // document goes hidden with any outstanding, remount the AnimatePresence so exiting dialogs are
  // dropped immediately. (Still-open dialogs remount too, which is acceptable at the moment the
  // window stops being visible.)
  const exitingCountRef = useRef(0)
  const prevHistoryRef = useRef(dialogHistory)
  const [presenceEpoch, setPresenceEpoch] = useState(0)

  useEffect(() => {
    const prevHistory = prevHistoryRef.current
    prevHistoryRef.current = dialogHistory

    const currentIds = new Set(dialogHistory.map(d => d.id))
    for (const d of prevHistory) {
      if (!currentIds.has(d.id)) {
        exitingCountRef.current += 1
      }
    }
  }, [dialogHistory])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && exitingCountRef.current > 0) {
        exitingCountRef.current = 0
        setPresenceEpoch(epoch => epoch + 1)
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  return (
    <AnimatePresence
      key={presenceEpoch}
      onExitComplete={() => {
        exitingCountRef.current = 0
      }}>
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
  const isDocVisible = useIsDocumentVisible()

  return (
    <>
      {/*
        While the document is hidden, animation frames never fire, so enter/exit animations can't
        progress — an exiting scrim would block unmounting forever. Render without them while
        hidden so mounts/unmounts complete immediately. (The dialog surface in material/dialog.tsx
        does the same.)
      */}
      <AnimatePresence propagate={true}>
        {isTopDialog && (
          <Scrim
            key='scrim'
            variants={scrimVariants}
            initial={isDocVisible ? 'initial' : false}
            animate='animate'
            exit={isDocVisible ? 'exit' : undefined}
            transition={scrimTransition}
            onClick={modal ? noop : event => onCancel(id, event)}
          />
        )}
      </AnimatePresence>

      <KeyListenerBoundary active={isTopDialog} key='dialog-content'>
        <FocusTrap focusableElem={focusableElem} focusOnMount={isTopDialog}>
          <span ref={setFocusableElem} tabIndex={-1}>
            <DialogContext.Provider value={{ isTopDialog }}>
              <React.Suspense fallback={null}>
                <DialogComponent
                  key={dialogState.id}
                  onCancel={modal ? noop : (event?: React.MouseEvent) => onCancel(id, event)}
                  close={() => onCancel(id)}
                  {...dialogState.initData}
                />
              </React.Suspense>
            </DialogContext.Provider>
          </span>
        </FocusTrap>
      </KeyListenerBoundary>
    </>
  )
}
