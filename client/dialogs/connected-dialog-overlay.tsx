import { rgba } from 'polished'
import React, { useCallback, useRef } from 'react'
import ReactDOM from 'react-dom'
import { animated, SpringValues, useTransition, UseTransitionProps } from 'react-spring'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import EditAccount from '../auth/edit-account'
import ChangelogDialog from '../changelog/changelog-dialog'
import { ChannelBanUserDialog } from '../chat/channel-ban-user-dialog'
import JoinChannelDialog from '../chat/join-channel'
import { useExternalElementRef } from '../dom/use-external-element-ref'
import DownloadDialog from '../download/download-dialog'
import MapDetailsDialog from '../maps/map-details'
import { MapPreviewDialog } from '../maps/map-preview'
import AcceptMatch from '../matchmaking/accept-match'
import { isHandledDismissalEvent } from '../material/dismissal-events'
import { defaultSpring } from '../material/springs'
import { zIndexDialogScrim } from '../material/zindex'
import { ExternalLinkDialog } from '../messaging/external-link-dialog'
import { PartyInviteDialog } from '../parties/party-invite-dialog'
import { PartyQueueAcceptDialog } from '../parties/party-queue-accept-dialog'
import {
  AcceptableUseDialog,
  PrivacyPolicyDialog,
  TermsOfServiceDialog,
} from '../policies/policy-displays'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import Settings from '../settings/settings'
import StarcraftPathDialog from '../settings/starcraft-path-dialog'
import { isStarcraftHealthy } from '../starcraft/is-starcraft-healthy'
import { ShieldBatteryHealthDialog } from '../starcraft/shieldbattery-health'
import StarcraftHealthCheckupDialog from '../starcraft/starcraft-health'
import { dialogScrim } from '../styles/colors'
import CreateWhisperSessionDialog from '../whispers/create-whisper'
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

  z-index: ${zIndexDialogScrim};

  -webkit-app-region: no-drag;
`

const INVISIBLE_SCRIM_COLOR = rgba(dialogScrim, 0)
const VISIBLE_SCRIM_COLOR = rgba(dialogScrim, 0.42)

export interface DialogContextValue {
  styles: SpringValues
}
export const DialogContext = React.createContext<DialogContextValue>({
  styles: {},
})

function getDialog(
  dialogType: DialogType,
  starcraftState: any,
): { component: React.ComponentType<any>; modal: boolean } {
  switch (dialogType) {
    case DialogType.AcceptMatch:
      return { component: AcceptMatch, modal: true }
    case DialogType.AcceptableUse:
      return { component: AcceptableUseDialog, modal: false }
    case DialogType.Account:
      return { component: EditAccount, modal: false }
    case DialogType.Changelog:
      return { component: ChangelogDialog, modal: false }
    case DialogType.ChannelJoin:
      return { component: JoinChannelDialog, modal: false }
    case DialogType.ChannelBanUser:
      return { component: ChannelBanUserDialog, modal: false }
    case DialogType.Download:
      return { component: DownloadDialog, modal: false }
    case DialogType.ExternalLink:
      return { component: ExternalLinkDialog, modal: false }
    case DialogType.MapDetails:
      return { component: MapDetailsDialog, modal: false }
    case DialogType.MapPreview:
      return { component: MapPreviewDialog, modal: false }
    case DialogType.PartyInvite:
      return { component: PartyInviteDialog, modal: false }
    case DialogType.PartyQueueAccept:
      return { component: PartyQueueAcceptDialog, modal: true }
    case DialogType.PrivacyPolicy:
      return { component: PrivacyPolicyDialog, modal: false }
    case DialogType.Settings:
      return isStarcraftHealthy({ starcraft: starcraftState })
        ? { component: Settings, modal: false }
        : { component: StarcraftPathDialog, modal: false }
    case DialogType.Simple:
      return { component: SimpleDialog, modal: false }
    case DialogType.ShieldBatteryHealth:
      return { component: ShieldBatteryHealthDialog, modal: false }
    case DialogType.StarcraftHealth:
      return { component: StarcraftHealthCheckupDialog, modal: false }
    case DialogType.StarcraftPath:
      return { component: StarcraftPathDialog, modal: false }
    case DialogType.TermsOfService:
      return { component: TermsOfServiceDialog, modal: false }
    case DialogType.Whispers:
      return { component: CreateWhisperSessionDialog, modal: false }
    default:
      return assertUnreachable(dialogType)
  }
}

export function ConnectedDialogOverlay() {
  const dispatch = useAppDispatch()
  const dialogHistory = useAppSelector(s => s.dialog.history)
  const isDialogOpen = dialogHistory.length > 0
  const topDialog = isDialogOpen ? dialogHistory[dialogHistory.length - 1] : undefined
  const starcraft = useAppSelector(s => s.starcraft)

  const focusableRef = useRef<HTMLSpanElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const portalRef = useExternalElementRef()

  const isTopDialogModal = topDialog ? getDialog(topDialog.type, starcraft).modal : false
  const onCancel = useCallback(
    (modal: boolean, event?: React.MouseEvent) => {
      if (!modal && (!event || !isHandledDismissalEvent(event.nativeEvent))) {
        dispatch(closeDialog())
      }
    },
    [dispatch],
  )
  const onFocusTrap = useCallback(() => {
    // Focus was about to leave the dialog area, redirect it back to the dialog
    focusableRef.current?.focus()
  }, [])

  const scrimTransition = useTransition(isDialogOpen, {
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

  const dialogTransition = useTransition<DialogState, UseTransitionProps<DialogState>>(
    dialogHistory,
    {
      from: { opacity: 0, transform: 'translate3d(0, -100%, 0) scale(0.6, 0.2)' },
      enter: { opacity: 1, transform: 'translate3d(0, 0%, 0) scale(1, 1)' },
      leave: { opacity: 0, transform: 'translate3d(0, -100%, 0) scale(0.6, 0.2)' },
      config: {
        ...defaultSpring,
        clamp: true,
      },
    },
  )

  return ReactDOM.createPortal(
    <>
      {scrimTransition(
        (styles, open) =>
          open && <Scrim style={styles} onClick={event => onCancel(isTopDialogModal, event)} />,
      )}
      {dialogTransition((styles, dialogState) => {
        const { component: DialogComponent, modal } = getDialog(dialogState.type, starcraft)

        // Dialog content implementations should focus *something* when mounted, so that our focus
        // traps have the proper effect of keeping focus in the dialog
        return (
          <>
            <span tabIndex={0} onFocus={onFocusTrap} />
            <span ref={focusableRef} tabIndex={-1}>
              <DialogContext.Provider value={{ styles }}>
                <DialogComponent
                  dialogRef={dialogRef}
                  onCancel={(event: React.MouseEvent) => onCancel(modal, event)}
                  {...dialogState.initData}
                />
              </DialogContext.Provider>
            </span>
            <span tabIndex={0} onFocus={onFocusTrap} />
          </>
        )
      })}
    </>,
    portalRef.current,
  )
}
