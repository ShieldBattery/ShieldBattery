import { writeFile as fsWriteFile } from 'fs/promises'
import { withFile as withTmpFile } from 'tmp-promise'
import { MapInfo } from '../../../common/maps'
import { SbUserId } from '../../../common/users/user-info'
import { readFile } from '../file-upload'
import { MapParseResult, mapPath, parseMap } from '../maps/store'
import { getMapInfo, updateParseData } from './map-models'
import { MAP_PARSER_VERSION } from './parser-version'

/**
 * Retrieves a map from storage so it can be processed locally (e.g. to regenerate images or
 * re-parse the data from it).
 */
export async function processStoredMapFile(
  mapInfo: MapInfo,
  processFn: (params: { path: string; mapInfo: MapInfo }) => Promise<void>,
): Promise<void> {
  const mapBufferPromise = readFile(mapPath(mapInfo.hash, mapInfo.mapData.format))
  await withTmpFile(async ({ path }) => {
    await fsWriteFile(path, await mapBufferPromise)
    await processFn({ path, mapInfo })
  })
}

/**
 * Checks that all the maps in the provided array have been parsed with the latest version of the
 * map parser, returning a new array with the most up-to-date parsing info. If all the maps are
 * up-to-date, the return array will contain the same objects as the input array.
 */
export async function reparseMapsAsNeeded(
  maps: ReadonlyArray<MapInfo>,
  favoritedBy?: SbUserId,
): Promise<MapInfo[]> {
  const needToParse = maps.filter(map => map.mapData.parserVersion < MAP_PARSER_VERSION)
  if (!needToParse.length) {
    return maps.slice()
  }

  await updateParseData(needToParse, async mapInfo => {
    let parseResult: MapParseResult | undefined
    await processStoredMapFile(mapInfo, async ({ path, mapInfo }) => {
      parseResult = await parseMap(path, mapInfo.mapData.format, false)
    })

    return [parseResult!.mapData, MAP_PARSER_VERSION]
  })

  return getMapInfo(
    maps.map(map => map.id),
    favoritedBy,
  )
}
