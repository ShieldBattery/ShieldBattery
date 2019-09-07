process.env.BABEL_ENV = 'node'

require('../../../babel-register-hook')
require('core-js/stable')
require('regenerator-runtime/runtime')
const fs = require('fs')
const Chk = require('bw-chk').default
const jpeg = require('jpeg-js')
const { parseAndHashMap } = require('../../../app/common/maps')

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

function generateImage(map, bwDataPath) {
  if (bwDataPath !== '') {
    // Create 1024x1024 images, or, if the map is not a square, have the larger of the
    // dimensions be 1024 pixels.
    let width
    let height
    if (map.size[0] > map.size[1]) {
      width = 1024
      height = map.size[1] * Math.floor(1024 / map.size[0])
    } else {
      height = 1024
      width = map.size[0] * Math.floor(1024 / map.size[1])
    }

    return map
      .image(Chk.fsFileAccess(bwDataPath), width, height, { melee: true })
      .then(imageRgb => {
        const rgbaBuffer = new Buffer(width * height * 4)
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
  } else {
    return Promise.resolve(null)
  }
}

process.once('message', msg => {
  console.assert(msg === 'init')
  process.send('init')
  parseAndHashMap(path, extension)
    .then(({ hash, map }) => {
      return generateImage(map, bwDataPath).then(image => {
        const imagePromise = new Promise((resolve, reject) => {
          if (image) {
            const imagePipe = fs.createWriteStream('', { fd: 3, flags: 'w' })
            imagePipe.on('error', reject).on('finish', resolve)

            imagePipe.write(image)
            imagePipe.end()
          } else {
            resolve()
          }
        })
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
        return Promise.all([imagePromise, sendPromise])
      })
    })
    .catch(e => {
      console.log(e)
      setImmediate(() => {
        process.exit(1)
      })
    })
})
