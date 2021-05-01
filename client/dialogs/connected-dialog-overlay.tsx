import React, { useCallback, useRef } from 'react'
import { CSSTransition, TransitionGroup } from 'react-transition-group'
import { assertUnreachable } from '../../common/assert-unreachable'
import EditAccount from '../auth/edit-account'
import ChangelogDialog from '../changelog/changelog-dialog'
import JoinChannelDialog from '../chat/join-channel'
import DownloadDialog from '../download/download-dialog'
import UpdateDialog from '../download/update-dialog'
import MapDetailsDialog from '../maps/map-details'
import AcceptMatch from '../matchmaking/accept-match'
import { Portal } from '../material/portal'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import Settings from '../settings/settings'
import StarcraftPathDialog from '../settings/starcraft-path-dialog'
import { isStarcraftHealthy } from '../starcraft/is-starcraft-healthy'
import { ShieldBatteryHealthDialog } from '../starcraft/shieldbattery-health'
import StarcraftHealthCheckupDialog from '../starcraft/starcraft-health'
import CreateWhisperSessionDialog from '../whispers/create-whisper'
import { closeDialog } from './action-creators'
import { DialogType } from './dialog-type'
import { SimpleDialog } from './simple-dialog'

const transitionNames = {
  appear: 'enter',
  appearActive: 'enterActive',
  enter: 'enter',
  enterActive: 'enterActive',
  exit: 'exit',
  exitActive: 'exitActive',
}

function getDialog(
  dialogType: DialogType,
  starcraftState: any,
): { component: React.ComponentType<any>; modal: boolean } {
  switch (dialogType) {
    case DialogType.AcceptMatch:
      return { component: AcceptMatch, modal: true }
    case DialogType.Account:
      return { component: EditAccount, modal: false }
    case DialogType.Changelog:
      return { component: ChangelogDialog, modal: false }
    case DialogType.Channel:
      return { component: JoinChannelDialog, modal: false }
    case DialogType.Download:
      return { component: DownloadDialog, modal: false }
    case DialogType.MapDetails:
      return { component: MapDetailsDialog, modal: false }
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
    case DialogType.UpdateAvailable:
      return { component: UpdateDialog, modal: true }
    case DialogType.Whispers:
      return { component: CreateWhisperSessionDialog, modal: false }
    default:
      return assertUnreachable(dialogType)
  }
}

export function ConnectedDialogOverlay() {
  const dispatch = useAppDispatch()
  const dialogState = useAppSelector(s => s.dialog)
  const starcraft = useAppSelector(s => s.starcraft)

  const focusableRef = useRef<HTMLSpanElement>(null)
  const dialogRef = useRef<HTMLElement>(null)

  const { dialogType } = dialogState
  const onCancel = useCallback(() => {
    const { modal } = getDialog(dialogType!, starcraft)
    if (!modal) {
      dispatch(closeDialog())
    }
  }, [dialogType, starcraft, dispatch])
  const onFocusTrap = useCallback(() => {
    // Focus was about to leave the dialog area, redirect it back to the dialog
    focusableRef.current?.focus()
  }, [])

  // Dialog content implementations should focus *something* when mounted, so that our focus traps
  // have the proper effect of keeping focus in the dialog
  let dialogComponent
  if (dialogState.isDialogOpened) {
    const { component: DialogComponent } = getDialog(dialogType!, starcraft)
    dialogComponent = (
      <CSSTransition
        classNames={transitionNames}
        timeout={{ enter: 350, exit: 250 }}
        nodeRef={dialogRef}>
        <DialogComponent
          key='dialog'
          dialogRef={dialogRef}
          onCancel={onCancel}
          {...dialogState.initData.toJS()}
        />
      </CSSTransition>
    )
  }

  // We always render a dialog even if we don't have one, so that its always mounted (and
  // thus usable for TransitionGroup animations)
  return (
    <Portal
      onDismiss={onCancel}
      open={true}
      scrim={dialogState.isDialogOpened}
      propagateClicks={true}>
      <span tabIndex={0} onFocus={onFocusTrap} />,
      <span ref={focusableRef} tabIndex={-1}>
        <TransitionGroup>{dialogComponent}</TransitionGroup>
      </span>
      ,
      <span tabIndex={0} onFocus={onFocusTrap} />
    </Portal>
  )
}
