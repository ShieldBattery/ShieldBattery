import Chk from 'bw-chk'
import httpErrors from 'http-errors'
import fs from 'fs'
import koaBody from 'koa-body'
import createScmExtractor from 'scm-extractor'
import HashThrough from '../../../app/common/hash-through'
import MAPS from '../maps/maps.json'
import { storeMap, mapInfo } from '../maps/store'
import { mapExists } from '../models/maps'

export default function(router) {
  router.get('/', ensureLoggedIn, list)
  router.post('/upload', ensureLoggedIn, koaBody({ multipart: true }), clearMultipartFiles, upload)
  router.get('/info/:hash', ensureLoggedIn, getInfo)
}

async function clearMultipartFiles(ctx, next) {
  try {
    await next()
  } finally {
    for (const { path } of Object.values(ctx.request.body.files)) {
      fs.unlink(path, e => {})
    }
  }
}

async function ensureLoggedIn(ctx, next) {
  if (!ctx.session.userId) {
    throw new httpErrors.Unauthorized()
  }

  await next()
}

async function upload(ctx, next) {
  const { timestamp, hash, extension, filename } = ctx.request.body.fields
  const { path } = ctx.request.body.files.data
  if (await mapExists(hash)) {
    ctx.status = 201
    ctx.body = {}
    return
  }
  if (extension !== 'scx' && extension !== 'scm') {
    throw new httpErrors.BadRequest('Map must have either .scm or .scx extension')
  }

  const hasher = new HashThrough()
  hasher.hasher.update(extension)
  const chkPromise = new Promise((resolve, reject) => {
    const stream = fs.createReadStream(path)
    const scmExtractor = createScmExtractor()
    stream.on('error', () => reject(new httpErrors.InternalServerError()))
    scmExtractor.on('error', () => reject(new httpErrors.BadRequest('Invalid map')))
    stream.pipe(hasher)
      .pipe(scmExtractor)
      .pipe(Chk.createStream((err, chk) => {
        if (err) {
          reject(new httpErrors.BadRequest('Invalid map'))
        } else {
          resolve(chk)
        }
      }))
  })
  const calculatedHash = await hasher.hashPromise

  if (hash !== calculatedHash) {
    throw new httpErrors.BadRequest("Data doesn't match the hash")
  }

  await storeMap(hash, extension, filename, await chkPromise, timestamp, path)
  ctx.status = 201
  ctx.body = {}
}

async function getInfo(ctx, next) {
  const hash = ctx.params.hash
  const info = await mapInfo(hash)
  if (info) {
    ctx.body = info
  } else {
    throw new httpErrors.NotFound()
  }
}

async function list(ctx, next) {
  let { page, limit } = ctx.request.query
  if (!page || page < 0) {
    page = 0
  }
  if (!limit || limit < 0 || limit > 100) {
    /* TODO(tec27): move back to 20 after we add paginated map list support */
    limit = 50
  }

  const maps = MAPS.slice(page * limit, (page + 1) * limit)
  ctx.body = {
    maps,
    page,
    limit,
    total: MAPS.length,
  }
}
