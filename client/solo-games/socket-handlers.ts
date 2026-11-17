import { NydusClient, RouteInfo } from 'nydus-client'
import { SoloGameEvent, SoloGameLaunchFailure } from '../../common/solo-games'
import { closeDialog, openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { dispatch, Dispatchable } from '../dispatch-registry'
import i18n from '../i18n/i18next'
import { jotaiStore } from '../jotai-store'
import logger from '../logging/logger'
import { externalShowSnackbar } from '../snackbars/snackbar-controller-registry'
import { DURATION_LONG } from '../snackbars/snackbar-durations'
import { soloLaunchPendingAtom } from './solo-game-atoms'
import { soloGameLaunchFailureMessage } from './solo-game-errors'

type EventToActionMap = {
  [E in SoloGameEvent['type']]: (
    event: Extract<SoloGameEvent, { type: E }>,
  ) => Dispatchable | undefined | void
}

/** Exported for tests; the socket route is registered by the default export. */
export const eventToAction: EventToActionMap = {
  gameStarted: event => dispatch => {
    logger.debug(`Solo game ${event.gameId} started`)
    jotaiStore.set(soloLaunchPendingAtom, false)
    dispatch(closeDialog(DialogType.LaunchingGame))
  },

  launchFailed: event => (dispatch, getState) => {
    logger.debug(`Solo game failed to launch: ${event.reason}`)
    jotaiStore.set(soloLaunchPendingAtom, false)
    dispatch(closeDialog(DialogType.LaunchingGame))

    // A game that failed to load for a reason the app has already explained in a dialog of its own
    // (the game's status names the reason) gets no second notice
    if (
      event.reason === SoloGameLaunchFailure.ClientFailed &&
      getState().gameClient.status?.launchErrorKind !== undefined
    ) {
      return
    }

    // A failed load is the moment this client's logs say the most about why, so the notice offers
    // a bug report, which uploads them
    externalShowSnackbar(soloGameLaunchFailureMessage(event.reason, i18n.t), DURATION_LONG, {
      action: {
        label: i18n.t('soloGames.launchFailed.reportBug', 'Report a bug'),
        onClick: () => dispatch(openDialog({ type: DialogType.BugReport })),
      },
    })
  },
}

export default function registerModule({ siteSocket }: { siteSocket: NydusClient }) {
  siteSocket.registerRoute('/solo-games/:userId', (_route: RouteInfo, event: SoloGameEvent) => {
    const action = eventToAction[event.type]?.(event as any)
    if (action) {
      dispatch(action)
    }
  })

  siteSocket.on('disconnect', () => {
    // The server only tells the connection that launched how the launch turned out, so once that
    // connection is gone the "Launching game…" dialog would never close. The game still starts
    // if it loads, and shows itself when it does.
    if (jotaiStore.get(soloLaunchPendingAtom)) {
      jotaiStore.set(soloLaunchPendingAtom, false)
      dispatch(closeDialog(DialogType.LaunchingGame))
    }
  })
}
