process.env.BABEL_ENV = 'node'

require('@babel/register')({
  // This is necessary to make babel compile stuff outside the "working directory".
  // See this issue for more info: https://github.com/babel/babel/issues/8321
  ignore: [/node_modules/],
})

const fs = require('fs')
const Chk = require('bw-chk').default
const jpeg = require('jpeg-js')
const { parseAndHashMap } = require('../../../common/maps')

// A map parsing script that runs in a separate process

const [path, extension, bwDataPath] = process.argv.slice(2)

function createLobbyInitData(chk) {
  const raceIdToName = {
    0: 'z',
    1: 't',
    2: 'p',
    5: 'any',
  }

  return {
    // Convert (acceptable) race ids to strings, set force's teamId and filter out empty ones.
    forces: chk.forces
      .map(({ name, players }, index) => ({
        name,
        teamId: index + 1,
        players: players.map(({ id, race, computer, typeId }) => {
          const raceName = raceIdToName[race]
          if (!raceName) {
            throw new Error(`Player ${id} has an invalid race ${race}`)
          }
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
function generateImage(map, bwDataPath, width = 1024) {
  if (!bwDataPath) {
    return Promise.resolve()
  }

  const height = Math.round((width * map.size[1]) / map.size[0])

  return map.image(Chk.fsFileAccess(bwDataPath), width, height, { melee: true }).then(imageRgb => {
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

function createStreamPromise(data, fd) {
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream('', { fd, flags: 'w' })
    stream.on('error', reject).on('finish', resolve)
    stream.write(data)
    stream.end()
  })
}

process.once('message', async msg => {
  console.assert(msg === 'init')
  process.send('init')

  try {
    const { hash, map } = await parseAndHashMap(path, extension)
    const [image, imagex2, thumbnail, thumbnailx2] = await Promise.all([
      generateImage(map, bwDataPath, 1024 /* width */),
      generateImage(map, bwDataPath, 2048 /* width */),
      generateImage(map, bwDataPath, 256 /* width */),
      generateImage(map, bwDataPath, 512 /* width */),
    ])
    const imagePromise = image ? createStreamPromise(image, 3 /* fd */) : Promise.resolve()
    const imagex2Promise = imagex2 ? createStreamPromise(imagex2, 4 /* fd */) : Promise.resolve()
    const thumbnailPromise = thumbnail
      ? createStreamPromise(thumbnail, 5 /* fd */)
      : Promise.resolve()
    const thumbnailx2Promise = thumbnailx2
      ? createStreamPromise(thumbnailx2, 6 /* fd */)
      : Promise.resolve()

    const sendPromise = new Promise(resolve =>
      process.send(
        {
          hash,
          title: map.title,
          description: map.description,
          width: map.size[0],
          height: map.size[1],
          tileset: map.tileset,
          meleePlayers: map.maxPlayers(false),
          umsPlayers: map.maxPlayers(true),
          lobbyInitData: createLobbyInitData(map),
        },
        resolve,
      ),
    )

    await Promise.all([
      sendPromise,
      imagePromise,
      imagex2Promise,
      thumbnailPromise,
      thumbnailx2Promise,
    ])
  } catch (err) {
    console.log(err)
    setImmediate(() => {
      process.exit(1)
    })
  }
})
