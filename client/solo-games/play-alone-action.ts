import { SbMapId } from '../../common/maps'
import { usePlayGate } from '../maps/map-host-action'
import { useAppDispatch } from '../redux-hooks'
import { openPlayAloneDialog } from './action-creators'

/**
 * Returns a function that opens the dialog for playing a map file alone. Outside the app it offers
 * the download instead, and a logged out viewer is sent to log in.
 */
export function usePlayAloneAction(): (mapId: SbMapId) => void {
  const dispatch = useAppDispatch()
  const playGate = usePlayGate()
  return mapId => playGate(() => dispatch(openPlayAloneDialog(mapId)))
}
