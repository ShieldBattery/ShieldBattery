import { Immutable } from 'immer'
import React, { useCallback, useMemo, useRef } from 'react'
import ReactDOM from 'react-dom'
import { UseTransitionProps, animated, useTransition } from 'react-spring'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { BugReportDialog } from '../bugs/bug-report-dialog'
import { ChangelogDialog } from '../changelog/changelog-dialog'
import { ChannelBanUserDialog } from '../chat/channel-ban-user-dialog'
import { ChannelSettingsDialog } from '../chat/channel-settings-dialog'
import { FocusTrap } from '../dom/focus-trap'
import { useExternalElementRef } from '../dom/use-external-element-ref'
import DownloadDialog from '../download/download-dialog'
import { KeyListenerBoundary } from '../keyboard/key-listener'
import { LeagueExplainerDialog } from '../leagues/league-explainer'
import MapDetailsDialog from '../maps/map-details'
import { MapPreviewDialog } from '../maps/map-preview'
import AcceptMatch from '../matchmaking/accept-match'
import { PostMatchDialog } from '../matchmaking/post-match-dialog'
import { DialogContext } from '../material/dialog'
import { isHandledDismissalEvent } from '../material/dismissal-events'
import { defaultSpring } from '../material/springs'
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
import StarcraftHealthCheckupDialog from '../starcraft/starcraft-health'
import { dialogScrimOpacity } from '../styles/colors'
import { CreateWhisper as CreateWhisperSessionDialog } from '../whispers/create-whisper'
import { closeDialog } from './action-creators'
import { DialogState } from './dialog-reducer'
import { DialogType } from './dialog-type'
import { SimpleDialog } from './simple-dialog'

const Scrim = styled(animated.div)`
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
      opacity: 0,
    },
    enter: { opacity: dialogScrimOpacity },
    leave: { opacity: 0 },
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
