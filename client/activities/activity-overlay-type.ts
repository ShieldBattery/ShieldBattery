import { Immutable } from 'immer'
import { MapInfoJson } from '../../common/maps'
import { LobbyActivityOverlayProps } from '../lobbies/lobby-activity-overlay'

export enum ActivityOverlayType {
  FindMatch = 'findMatch',
  // TODO(tec27): Combine Create/Join into one thing?
  Lobby = 'lobby',
  // TODO(tec27): Combine all these map overlays into one thing?
  BrowseLocalMaps = 'browseLocalMaps',
  BrowseServerMaps = 'browseServerMaps',
  // TODO(tec27): Rename to "BrowseReplays"?
  BrowseLocalReplays = 'browseLocalReplays',
}

type BaseActivityOverlayPayload<T, DataType = undefined> = DataType extends undefined
  ? { type: T; initData?: undefined }
  : { type: T; initData: DataType }

type FindMatchPayload = BaseActivityOverlayPayload<typeof ActivityOverlayType.FindMatch>
type LobbyPayload = BaseActivityOverlayPayload<
  typeof ActivityOverlayType.Lobby,
  LobbyActivityOverlayProps | undefined
>
// TODO(tec27): Adjust these to match their actual types, unsure what they are right now but they
// are basically all not TS-ified anyway so it will still build
type BrowseLocalMapsPayload = BaseActivityOverlayPayload<
  typeof ActivityOverlayType.BrowseLocalMaps,
  {
    title: string
    // TODO(tec27): These shouldn't really be necessary to pass in initData (and these aren't
    // serializable so they really shouldn't be stored in a reducer). Handle this kind of stuff in
    // a better way
    onMapUpload?: (map: Immutable<MapInfoJson>) => void
    onMapSelect?: (map: Immutable<MapInfoJson>) => void
    onMapDetails?: (map: Immutable<MapInfoJson>) => void
    onRemoveMap?: (map: Immutable<MapInfoJson>) => void
    onRegenMapImage?: (map: Immutable<MapInfoJson>) => void
  }
>
type BrowseServerMapsPayload = BaseActivityOverlayPayload<
  typeof ActivityOverlayType.BrowseServerMaps,
  {
    title: string
    uploadedMap?: Immutable<MapInfoJson>
    // TODO(tec27): These shouldn't really be necessary to pass in initData (and these aren't
    // serializable so they really shouldn't be stored in a reducer). Handle this kind of stuff in
    // a better way
    onMapUpload?: (map: Immutable<MapInfoJson>) => void
    onMapSelect?: (map: Immutable<MapInfoJson>) => void
    onMapDetails?: (map: Immutable<MapInfoJson>) => void
    onRemoveMap?: (map: Immutable<MapInfoJson>) => void
    onRegenMapImage?: (map: Immutable<MapInfoJson>) => void
  }
>
type BrowseLocalReplaysPayload = BaseActivityOverlayPayload<
  typeof ActivityOverlayType.BrowseLocalReplays
>

export type ActivityOverlayPayload =
  | FindMatchPayload
  | LobbyPayload
  | BrowseLocalMapsPayload
  | BrowseServerMapsPayload
  | BrowseLocalReplaysPayload
