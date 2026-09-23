import { Immutable } from 'immer'
import { AnimatePresence, Transition, Variants } from 'motion/react'
import * as m from 'motion/react-m'
import React, { useEffect, useEffectEvent, useState } from 'react'
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
const AdminCloseChannelDialog = React.lazy(async () => ({
  default: (await import('../chat/admin/admin-channel-dialogs')).AdminCloseChannelDialog,
}))
const AdminDeleteChannelDialog = React.lazy(async () => ({
  default: (await import('../chat/admin/admin-channel-dialogs')).AdminDeleteChannelDialog,
}))
const AdminRenameChannelDialog = React.lazy(async () => ({
  default: (await import('../chat/admin/admin-channel-dialogs')).AdminRenameChannelDialog,
}))
const BugReportDialog = React.lazy(async () => ({
  default: (await import('../bugs/bug-report-dialog')).BugReportDialog,
}))
const BotDetailsDialog = React.lazy(async () => ({
  default: (await import('../practice/bot-details-dialog')).BotDetailsDialog,
}))
const LocalBuildDialog = React.lazy(async () => ({
  default: (await import('../practice/local-build-dialog')).LocalBuildDialog,
}))
const PracticeLaunchingDialog = React.lazy(async () => ({
  default: (await import('../practice/practice-launching-dialog')).PracticeLaunchingDialog,
}))
const PresetNameDialog = React.lazy(async () => ({
  default: (await import('../practice/preset-name-dialog')).PresetNameDialog,
}))
const PracticeReadinessDialog = React.lazy(async () => ({
  default: (await import('../practice/readiness-dialogs')).PracticeReadinessDialog,
}))
const ChannelDeleteMessageDialog = React.lazy(async () => ({
  default: (await import('../chat/delete-message-dialog')).ChannelDeleteMessageDialog,
}))
const ChannelBanUserDialog = React.lazy(async () => ({
  default: (await import('../chat/channel-ban-user-dialog')).ChannelBanUserDialog,
}))
const ChannelCreateConfirmation = React.lazy(async () => ({
  default: (await import('../chat/channel-create-confirmation-dialog')).ChannelCreateConfirmation,
}))
const ChannelKickUserConfirmation = React.lazy(async () => ({
  default: (await import('../chat/channel-kick-user-dialog')).ChannelKickUserConfirmation,
}))
const ChannelLeaveConfirmation = React.lazy(async () => ({
  default: (await import('../chat/channel-leave-dialog')).ChannelLeaveConfirmation,
}))
const ChannelInviteLinkDialog = React.lazy(async () => ({
  default: (await import('../chat/channel-invite-link-dialog')).ChannelInviteLinkDialog,
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
const ChatCommandHelpDialog = React.lazy(async () => ({
  default: (await import('../messaging/commands/chat-command-help-dialog')).ChatCommandHelpDialog,
}))
const DownloadDialog = React.lazy(() => import('../download/download-dialog'))
const ReportGameDialog = React.lazy(async () => ({
  default: (await import('../games/report-game-dialog')).ReportGameDialog,
}))
const ResolveGameResultsDialog = React.lazy(async () => ({
  default: (await import('../games/resolve-game-dialog')).ResolveGameResultsDialog,
}))
const LeagueExplainerDialog = React.lazy(async () => ({
  default: (await import('../leagues/league-explainer')).LeagueExplainerDialog,
}))
const LeaveLeagueDialog = React.lazy(async () => ({
  default: (await import('../leagues/leave-league-dialog')).LeaveLeagueDialog,
}))
const JoinCodeDialog = React.lazy(async () => ({
  default: (await import('../lobbies/join-code-dialog')).JoinCodeDialog,
}))
const LobbyLeaveAndCreateDialog = React.lazy(async () => ({
  default: (await import('../lobbies/lobby-leave-and-create-dialog')).LobbyLeaveAndCreateDialog,
}))
const LobbyLeaveAndJoinDialog = React.lazy(async () => ({
  default: (await import('../lobbies/lobby-leave-and-join-dialog')).LobbyLeaveAndJoinDialog,
}))
const MapDetailsDialog = React.lazy(() => import('../maps/map-details'))
const MapDownloadDialog = React.lazy(async () => ({
  default: (await import('../maps/map-download-dialog')).MapDownloadDialog,
}))
const MapPreviewDialog = React.lazy(async () => ({
  default: (await import('../maps/map-preview')).MapPreviewDialog,
}))
const AcceptMatchDialog = React.lazy(async () => ({
  default: (await import('../matchmaking/accept-match-dialog')).AcceptMatchDialog,
}))
const FailedToAcceptMatchDialog = React.lazy(async () => ({
  default: (await import('../matchmaking/accept-match-dialog')).FailedToAcceptMatchDialog,
}))
const MatchCanceledDialog = React.lazy(async () => ({
  default: (await import('../matchmaking/match-canceled-dialog')).MatchCanceledDialog,
}))
const MatchmakingBannedDialog = React.lazy(async () => ({
  default: (await import('../matchmaking/matchmaking-banned-dialog')).MatchmakingBannedDialog,
}))
const NewsPostDeleteConfirmation = React.lazy(async () => ({
  default: (await import('../news/news-post-delete-dialog')).NewsPostDeleteConfirmation,
}))
const NewsPostSettingsDialog = React.lazy(async () => ({
  default: (await import('../admin/news-post-settings-dialog')).NewsPostSettingsDialog,
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
const GameDefaultsApplyDialog = React.lazy(async () => ({
  default: (await import('../settings/game/game-defaults-apply-dialog')).GameDefaultsApplyDialog,
}))
const GameDefaultsFirstRunDialog = React.lazy(async () => ({
  default: (await import('../settings/game/game-defaults-first-run-dialog'))
    .GameDefaultsFirstRunDialog,
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
const TwitchRemoveLiveStreamConfirmation = React.lazy(async () => ({
  default: (await import('../twitch/remove-live-stream-dialog')).TwitchRemoveLiveStreamConfirmation,
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
      return { component: AcceptMatchDialog }
    case DialogType.AcceptableUse:
      return { component: AcceptableUseDialog }
    case DialogType.AdminCloseChannel:
      return { component: AdminCloseChannelDialog }
    case DialogType.AdminDeleteChannel:
      return { component: AdminDeleteChannelDialog }
    case DialogType.AdminRenameChannel:
      return { component: AdminRenameChannelDialog }
    case DialogType.BotDetails:
      return { component: BotDetailsDialog }
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
    case DialogType.ChannelCreateConfirmation:
      return { component: ChannelCreateConfirmation }
    case DialogType.ChannelDeleteMessage:
      return { component: ChannelDeleteMessageDialog }
    case DialogType.ChannelKickUserConfirmation:
      return { component: ChannelKickUserConfirmation }
    case DialogType.ChannelLeaveConfirmation:
      return { component: ChannelLeaveConfirmation }
    case DialogType.ChannelTransferOwnership:
      return { component: ChannelTransferOwnershipDialog }
    case DialogType.ChannelInviteLink:
      return { component: ChannelInviteLinkDialog }
    case DialogType.ChannelUnbanUser:
      return { component: ChannelUnbanUserConfirmation }
    case DialogType.ChannelUserPermissions:
      return { component: ChannelUserPermissionsDialog }
    case DialogType.ChatCommandHelp:
      return { component: ChatCommandHelpDialog }
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
    case DialogType.GameDefaultsApply:
      return { component: GameDefaultsApplyDialog }
    case DialogType.GameDefaultsFirstRun:
      return { component: GameDefaultsFirstRunDialog, modal: true }
    case DialogType.JoinCode:
      return { component: JoinCodeDialog }
    case DialogType.LaunchingGame:
      return { component: LaunchingGameDialog, modal: true }
    case DialogType.LeagueExplainer:
      return { component: LeagueExplainerDialog }
    case DialogType.LeaveLeague:
      return { component: LeaveLeagueDialog }
    case DialogType.LobbyLeaveAndCreate:
      return { component: LobbyLeaveAndCreateDialog }
    case DialogType.LobbyLeaveAndJoin:
      return { component: LobbyLeaveAndJoinDialog }
    case DialogType.LocalBuildBot:
      return { component: LocalBuildDialog }
    case DialogType.MapDetails:
      return { component: MapDetailsDialog }
    case DialogType.MapDownload:
      return { component: MapDownloadDialog, modal: true }
    case DialogType.MapPreview:
      return { component: MapPreviewDialog }
    case DialogType.Markdown:
      return { component: MarkdownDialog }
    case DialogType.MatchCanceled:
      return { component: MatchCanceledDialog }
    case DialogType.MatchmakingBanned:
      return { component: MatchmakingBannedDialog }
    case DialogType.NewsPostDeleteConfirmation:
      return { component: NewsPostDeleteConfirmation }
    case DialogType.NewsPostSettings:
      return { component: NewsPostSettingsDialog }
    case DialogType.PostMatch:
      return { component: PostMatchDialog }
    case DialogType.PracticeLaunching:
      return { component: PracticeLaunchingDialog, modal: true }
    case DialogType.PracticePresetName:
      return { component: PresetNameDialog }
    case DialogType.PracticeReadiness:
      return { component: PracticeReadinessDialog }
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
    case DialogType.ResolveGameResults:
      return { component: ResolveGameResultsDialog }
    case DialogType.Simple:
      return { component: SimpleDialog }
    case DialogType.ShieldBatteryHealth:
      return { component: ShieldBatteryHealthDialog }
    case DialogType.StarcraftHealth:
      return { component: StarcraftHealthCheckupDialog }
    case DialogType.TermsOfService:
      return { component: TermsOfServiceDialog }
    case DialogType.TwitchRemoveLiveStreamConfirmation:
      return { component: TwitchRemoveLiveStreamConfirmation }
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
      onCancel={id => dispatch(closeDialogById(id))}
      onScrimClick={(id, event) => {
        // A click outside of a popover dismisses that popover, so a scrim click that did so is not
        // also a request to close the dialog
        if (!isHandledDismissalEvent(event.nativeEvent)) {
          dispatch(closeDialogById(id))
        }
      }}
    />,
    portalElem,
  )
}

/**
 * How long a closed dialog may stay on screen for its exit animation before it is removed outright.
 * Exit animations finish well within this; one still running at this point has stalled (e.g.
 * because animation frames aren't being delivered) and would otherwise leave the dialog on screen,
 * unclosable, for good.
 */
export const EXIT_DEADLINE_MS = 1500

/**
 * Returns the dialogs to render: everything in `history`, plus the dialogs from `prevRendered` that
 * have left it and are still exiting. Each exiting dialog stays just after the dialog it was
 * rendered after, so it animates out at the same place in the stack it was shown at.
 */
export function mergeExitingDialogs<T extends { readonly id: string }>(
  prevRendered: ReadonlyArray<T>,
  history: ReadonlyArray<T>,
): T[] {
  const presentIds = history.map(d => d.id)
  const result = [...history]
  let insertionIndex = 0
  let exitingCount = 0
  for (const dialog of prevRendered) {
    const presentIndex = presentIds.indexOf(dialog.id)
    if (presentIndex === -1) {
      result.splice(insertionIndex, 0, dialog)
      insertionIndex += 1
      exitingCount += 1
    } else {
      insertionIndex = presentIndex + exitingCount + 1
    }
  }
  return result
}

function DialogOverlayContent({
  dialogHistory,
  onCancel,
  onScrimClick,
}: {
  dialogHistory: Immutable<DialogState[]>
  onCancel: (id: string) => void
  onScrimClick: (id: string, event: React.MouseEvent) => void
}) {
  const isDocVisible = useIsDocumentVisible()
  // Dialogs that have left the history keep rendering here until their exit animation completes.
  // Animation frames stop entirely while the document is hidden (window minimized/fully occluded),
  // so an exit could never finish then: dialogs closed while hidden, or still exiting when the
  // document becomes hidden, are dropped immediately instead.
  const [rendered, setRendered] = useState<ReadonlyArray<Immutable<DialogState>>>(dialogHistory)
  const [prevHistory, setPrevHistory] = useState(dialogHistory)
  if (dialogHistory !== prevHistory) {
    setPrevHistory(dialogHistory)
    setRendered(isDocVisible ? mergeExitingDialogs(rendered, dialogHistory) : dialogHistory)
  } else if (!isDocVisible && rendered.length > dialogHistory.length) {
    setRendered(dialogHistory)
  }

  const presentIds = new Set(dialogHistory.map(d => d.id))
  const topId = dialogHistory.at(-1)?.id
  const onExited = (id: string) => setRendered(dialogs => dialogs.filter(d => d.id !== id))

  return (
    <>
      {rendered.map(dialogState => (
        <DialogPresence
          key={dialogState.id}
          isPresent={presentIds.has(dialogState.id)}
          onExited={() => onExited(dialogState.id)}>
          <DialogDisplay
            key={dialogState.id}
            dialogState={dialogState}
            isTopDialog={dialogState.id === topId}
            onCancel={onCancel}
            onScrimClick={onScrimClick}
          />
        </DialogPresence>
      ))}
    </>
  )
}

/**
 * Runs a single dialog's exit animation once it is no longer present, calling `onExited` when that
 * finishes or, if it never does, once `EXIT_DEADLINE_MS` has passed. Each dialog gets its own
 * presence so a stalled exit can be cut short without remounting the dialogs that are still open.
 */
function DialogPresence({
  isPresent,
  onExited,
  children,
}: {
  isPresent: boolean
  onExited: () => void
  children: React.ReactNode
}) {
  const onDeadline = useEffectEvent(onExited)
  useEffect(() => {
    if (isPresent) {
      return undefined
    }

    const timeout = setTimeout(onDeadline, EXIT_DEADLINE_MS)
    return () => clearTimeout(timeout)
  }, [isPresent])

  return <AnimatePresence onExitComplete={onExited}>{isPresent ? children : null}</AnimatePresence>
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
  onScrimClick,
}: {
  dialogState: Immutable<DialogState>
  isTopDialog: boolean
  onCancel: (id: string) => void
  onScrimClick: (id: string, event: React.MouseEvent) => void
}) {
  const { type: dialogType, id } = dialogState
  const { component: DialogComponent, modal } = getDialog(dialogType)

  const [focusableElem, setFocusableElem] = useState<HTMLSpanElement | null>(null)
  const isDocVisible = useIsDocumentVisible()

  return (
    <>
      {/*
        While the document is hidden, animation frames never fire, so an entrance animation can't
        progress. Mount without it while hidden. (The dialog surface in material/dialog.tsx does
        the same.)
      */}
      <AnimatePresence propagate={true}>
        {isTopDialog && (
          <Scrim
            key='scrim'
            variants={scrimVariants}
            initial={isDocVisible ? 'initial' : false}
            animate='animate'
            exit='exit'
            transition={scrimTransition}
            onClick={modal ? noop : event => onScrimClick(id, event)}
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
                  onCancel={modal ? noop : () => onCancel(id)}
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
