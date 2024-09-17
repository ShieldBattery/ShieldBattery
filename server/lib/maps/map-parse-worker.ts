import ChkModule, { ForcePlayerRace } from 'bw-chk'
import jpeg from 'jpeg-js'
import * as fs from 'node:fs'
import { getErrorStack } from '../../../common/errors.js'
import { filterColorCodes } from '../../../common/maps.js'
import { parseAndHashMap } from './parse-map.js'

type Chk = ChkModule.default

// A map parsing script that runs in a separate process

const [path, extension, bwDataPath] = process.argv.slice(2)

const raceIdToName: Partial<Record<ForcePlayerRace, string>> = {
  [ForcePlayerRace.Zerg]: 'z',
  [ForcePlayerRace.Terran]: 't',
  [ForcePlayerRace.Protoss]: 'p',
  [ForcePlayerRace.UserSelectable]: 'any',
}

function createLobbyInitData(chk: Chk) {
  return {
    // Convert race ids to strings, set force's teamId and filter out empty ones.
    forces: chk.forces
      .map(({ name, players }, index) => ({
        name,
        teamId: index + 1,
        players: players.map(({ id, race, computer, typeId }) => {
          // While the raceIdToName map keys are the "intended" mappings,
          // there are other values that a map can use. At least race 6
          // makes SC:R melee lobbies default to random race without requiring
          // user to select it same way that race 5 would.
          // But we have our own lobby system which doesn't require users
          // to explicitly choose races before starting game.
          //
          // Anyway, this 'forces' object is only used by us to set up UMS lobbies.
          // The player race in UMS mainly selects which music & UI console are used.
          // Exception being race 5 ('any'), where the player selects a race, will not
          // get any preplaced units, and spawn with that race's starting units.
          //
          // So choosing terran here is fine as a fallback.
          const raceName = raceIdToName[race] ?? 't'
          return {
            id,
            computer,
            typeId,
            race: raceName,
          }
        }),
      }))
      .filter(f => f.players.length !== 0),
  }
}

// Creates an image with the provided width and calculates height so the aspect ratio is preserved.
function generateImage(map: Chk, bwDataPath: string, width = 1024): Promise<Buffer | void> {
  if (!bwDataPath) {
    return Promise.resolve()
  }

  const height = Math.round((width * map.size[1]) / map.size[0])

  return map
    .image(ChkModule.default.fsFileAccess(bwDataPath), width, height, { melee: true })
    .then(imageRgb => {
      const rgbaBuffer = Buffer.alloc(width * height * 4)
      for (let i = 0; i < width * height; i++) {
        rgbaBuffer[i * 4] = imageRgb[i * 3]
        rgbaBuffer[i * 4 + 1] = imageRgb[i * 3 + 1]
        rgbaBuffer[i * 4 + 2] = imageRgb[i * 3 + 2]
      }
      const { data } = jpeg.encode(
        {
          data: rgbaBuffer,
          width,
          height,
        },
        90,
      )
      return data
    })
}

function createStreamPromise(data: Buffer, fd: number) {
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream('', { fd, flags: 'w' })
    stream.on('error', reject).on('finish', resolve)
    stream.write(data)
    stream.end()
  })
}

process.once('message', async msg => {
  if (msg !== 'init') {
    throw new Error('Unexpected process message: ' + msg)
  }
  if (!process.send) {
    throw new Error('Map parse worker must be run as a child process')
  }
  process.send('init')

  try {
    const { hash, map } = await parseAndHashMap(path, extension)
    const [image256, image512, image1024, image2048] = await Promise.all([
      generateImage(map, bwDataPath, 256 /* width */),
      generateImage(map, bwDataPath, 512 /* width */),
      generateImage(map, bwDataPath, 1024 /* width */),
      generateImage(map, bwDataPath, 2048 /* width */),
    ])
    const image256Promise = image256 ? createStreamPromise(image256, 3 /* fd */) : Promise.resolve()
    const image512Promise = image512 ? createStreamPromise(image512, 4 /* fd */) : Promise.resolve()
    const image1024Promise = image1024
      ? createStreamPromise(image1024, 5 /* fd */)
      : Promise.resolve()
    const image2048Promise = image2048
      ? createStreamPromise(image2048, 6 /* fd */)
      : Promise.resolve()

    const sendPromise = new Promise(resolve =>
      process.send!(
        {
          hash,
          title: filterColorCodes(map.title),
          description: filterColorCodes(map.description),
          width: map.size[0],
          height: map.size[1],
          tileset: map.tileset,
          meleePlayers: map.maxPlayers(false),
          umsPlayers: map.maxPlayers(true),
          isEud: map.isEudMap(),
          lobbyInitData: createLobbyInitData(map),
        },
        resolve,
      ),
    )

    await Promise.all([
      sendPromise,
      image256Promise,
      image512Promise,
      image1024Promise,
      image2048Promise,
    ])
  } catch (err) {
    Promise.resolve().then(() => {
      process.send!({ error: getErrorStack(err) }, () => {
        setImmediate(() => {
          process.exit(1)
        })
      })
    })
  }
})
