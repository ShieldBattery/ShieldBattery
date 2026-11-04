import { useEffect, useEffectEvent, useState } from 'react'
import { TypedIpcRenderer } from '../../common/ipc'
import { MapExtension, SbMapId } from '../../common/maps'
import logger from '../logging/logger'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { batchGetMapInfo } from './action-creators'

const ipcRenderer = new TypedIpcRenderer()

/** The map file the app renders full-detail tiles of a map's image from (see `mapTileUrl`). */
export interface MapTileSource {
  hash: string
  format: MapExtension
}

/**
 * The file to request tiles of `mapId`'s image for, once the app has it: the app renders tiles from
 * the map files on this PC, so the map is downloaded to its map store first (as it is for games).
 * Always `undefined` outside the app.
 */
export function useMapTileSource(mapId: SbMapId): MapTileSource | undefined {
  const dispatch = useAppDispatch()
  const mapInfo = useAppSelector(s => (IS_ELECTRON ? s.maps.byId.get(mapId) : undefined))
  const [downloadedHash, setDownloadedHash] = useState<string>()

  useEffect(() => {
    if (IS_ELECTRON) {
      dispatch(batchGetMapInfo(mapId))
    }
  }, [dispatch, mapId])

  const hash = mapInfo?.hash
  const format = mapInfo?.mapData.format
  const hasUrl = !!mapInfo?.mapUrl
  // The URL is signed, so it changes each time the map's info is fetched: a new one is no reason to
  // download again.
  const download = useEffectEvent((onDone: () => void) => {
    if (!mapInfo?.mapUrl) {
      return
    }
    ipcRenderer
      .invoke('mapStoreDownloadMap', mapInfo.hash, mapInfo.mapData.format, mapInfo.mapUrl)
      ?.then(onDone)
      .catch(err => {
        logger.warning(`Couldn't download map ${mapInfo.hash} for its tiles: ${err?.stack ?? err}`)
      })
  })
  useEffect(() => {
    if (!hash || !hasUrl) {
      return undefined
    }
    let cancelled = false
    download(() => {
      if (!cancelled) {
        setDownloadedHash(hash)
      }
    })
    return () => {
      cancelled = true
    }
  }, [hash, format, hasUrl])

  return hash && format && downloadedHash === hash ? { hash, format } : undefined
}
