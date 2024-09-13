import { Immutable } from 'immer'
import { rgba } from 'polished'
import React, { useCallback, useMemo, useRef } from 'react'
import ReactDOM from 'react-dom'
import { UseTransitionProps, animated, useTransition } from 'react-spring'
import { styled } from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable.js'
import { BugReportDialog } from '../bugs/bug-report-dialog.js'
import { ChangelogDialog } from '../changelog/changelog-dialog.js'
import { ChannelBanUserDialog } from '../chat/channel-ban-user-dialog.js'
import { ChannelSettingsDialog } from '../chat/channel-settings-dialog.js'
import { FocusTrap } from '../dom/focus-trap.js'
import { useExternalElementRef } from '../dom/use-external-element-ref.js'
import DownloadDialog from '../download/download-dialog.js'
import { KeyListenerBoundary } from '../keyboard/key-listener.js'
import { LeagueExplainerDialog } from '../leagues/league-explainer.js'
import MapDetailsDialog from '../maps/map-details.js'
import { MapPreviewDialog } from '../maps/map-preview.js'
import AcceptMatch from '../matchmaking/accept-match.js'
import { PostMatchDialog } from '../matchmaking/post-match-dialog.js'
import { DialogContext } from '../material/dialog.js'
import { isHandledDismissalEvent } from '../material/dismissal-events.js'
import { defaultSpring } from '../material/springs.js'
import { zIndexDialogScrim } from '../material/zindex.js'
import { ExternalLinkDialog } from '../navigation/external-link-dialog.js'
import { PartyInviteDialog } from '../parties/party-invite-dialog.js'
import { PartyQueueAcceptDialog } from '../parties/party-queue-accept-dialog.js'
import {
  AcceptableUseDialog,
  PrivacyPolicyDialog,
  TermsOfServiceDialog,
} from '../policies/policy-displays.js'
import { useAppDispatch, useAppSelector } from '../redux-hooks.js'
import { ReplayInfoDialog } from '../replays/replay-info-display.js'
import { ReplayLoadDialog } from '../replays/replay-load-dialog.js'
import { ChangeEmailDialog, ChangePasswordDialog } from '../settings/user/account-settings.js'
import { ShieldBatteryHealthDialog } from '../starcraft/shieldbattery-health.js'
import StarcraftHealthCheckupDialog from '../starcraft/starcraft-health.js'
import { dialogScrim } from '../styles/colors.js'
import { CreateWhisper as CreateWhisperSessionDialog } from '../whispers/create-whisper.js'
import { closeDialog } from './action-creators.js'
import { DialogState } from './dialog-reducer.js'
import { DialogType } from './dialog-type.js'
import { SimpleDialog } from './simple-dialog.js'

const Scrim = styled(animated.div)`
  position: fixed;
  left: 0;
  top: var(--sb-system-bar-height, 0);
  right: 0;
  bottom: 0;

  z-index: ${zIndexDialogScrim};

  -webkit-app-region: no-drag;
`

const INVISIBLE_SCRIM_COLOR = rgba(dialogScrim, 0)
const VISIBLE_SCRIM_COLOR = rgba(dialogScrim, 0.42)

const noop = () => {}

function getDialog(dialogType: DialogType): {
  component: React.ComponentType<any>
  modal?: boolean
} {
  switch (dialogType) {
    case DialogType.AcceptMatch:
      return { component: AcceptMatch, modal: true }
    case DialogType.AcceptableUse:
      return { component: AcceptableUseDialog }
    case DialogType.BugReport:
      return { component: BugReportDialog }
    case DialogType.Changelog:
      return { component: ChangelogDialog }
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
    case DialogType.ExternalLink:
      return { component: ExternalLinkDialog }
    case DialogType.LeagueExplainer:
      return { component: LeagueExplainerDialog }
    case DialogType.MapDetails:
      return { component: MapDetailsDialog }
    case DialogType.MapPreview:
      return { component: MapPreviewDialog }
    case DialogType.PartyInvite:
      return { component: PartyInviteDialog }
    case DialogType.PartyQueueAccept:
      return { component: PartyQueueAcceptDialog, modal: true }
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
      return assertUnreachable(dialogType)
  }
}

export const ConnectedDialogOverlay = () => {
  const dispatch = useAppDispatch()
  const dialogHistory = useAppSelector(s => s.dialog.history)
  const portalRef = useExternalElementRef()

  const onCancel = useCallback(
    (dialogType: DialogType | 'all', event?: React.MouseEvent) => {
      if (!event || !isHandledDismissalEvent(event.nativeEvent)) {
        dispatch(closeDialog(dialogType))
      }
    },
    [dispatch],
  )

  return ReactDOM.createPortal(
    <DialogOverlayContent dialogHistory={dialogHistory} onCancel={onCancel} />,
    portalRef.current,
  )
}

function DialogOverlayContent({
  dialogHistory,
  onCancel,
}: {
  dialogHistory: Immutable<DialogState[]>
  onCancel: (dialogType: DialogType | 'all', event?: React.MouseEvent) => void
}) {
  const dialogTransition = useTransition<Immutable<DialogState>, UseTransitionProps<DialogState>>(
    dialogHistory,
    {
      keys: useCallback((dialog: Immutable<DialogState>) => dialog.id, []),
      from: { opacity: 0, transform: 'translate3d(0, -100%, 0) scale(0.6, 0.2)' },
      enter: { opacity: 1, transform: 'translate3d(0, 0%, 0) scale(1, 1)' },
      leave: { opacity: -0.5, transform: 'translate3d(0, -120%, 0) scale(0.4, 0.15)' },
      config: (_item, _index, phase) => key =>
        key === 'opacity' || phase === 'leave' ? { ...defaultSpring, clamp: true } : defaultSpring,
    },
  )

  return dialogTransition((dialogStyles, dialogState, transition, index) => (
    <DialogDisplay
      dialogStyles={dialogStyles}
      dialogState={dialogState}
      isTopDialog={dialogHistory.length - 1 === index}
      onCancel={onCancel}
    />
  ))
}

function DialogDisplay({
  dialogStyles,
  dialogState,
  isTopDialog,
  onCancel: propsOnCancel,
}: {
  dialogStyles: React.CSSProperties
  dialogState: Immutable<DialogState>
  isTopDialog: boolean
  onCancel: (dialogType: DialogType | 'all', event?: React.MouseEvent) => void
}) {
  const dialogType = dialogState.type
  const { component: DialogComponent, modal } = getDialog(dialogState.type)

  const focusableRef = useRef<HTMLSpanElement>(null)
  const dialogRef = useRef<HTMLElement>(null)

  const scrimTransition = useTransition(isTopDialog, {
    key: isTopDialog,
    from: {
      background: INVISIBLE_SCRIM_COLOR,
    },
    enter: { background: VISIBLE_SCRIM_COLOR },
    leave: { background: INVISIBLE_SCRIM_COLOR },
    config: {
      ...defaultSpring,
      clamp: true,
    },
  })

  const onCancel = useMemo(
    () => (modal ? noop : (event: React.MouseEvent) => propsOnCancel(dialogType, event)),
    [propsOnCancel, modal, dialogType],
  )

  return (
    <>
      {scrimTransition((scrimStyles, show) => {
        return show ? <Scrim style={scrimStyles} onClick={onCancel} key='scrim' /> : undefined
      })}

      <KeyListenerBoundary active={isTopDialog} key='dialog-content'>
        <FocusTrap focusableRef={focusableRef}>
          <span ref={focusableRef} tabIndex={-1}>
            <DialogContext.Provider
              value={{
                styles: dialogStyles,
                isTopDialog,
              }}>
              <DialogComponent
                dialogRef={dialogRef}
                key={dialogState.id}
                onCancel={onCancel}
                {...dialogState.initData}
              />
            </DialogContext.Provider>
          </span>
        </FocusTrap>
      </KeyListenerBoundary>
    </>
  )
}
