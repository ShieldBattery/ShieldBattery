import httpErrors from 'http-errors'
import { Seq } from 'immutable'
import MAPS from '../maps/maps.json'
import { storeMap, mapInfo } from '../maps/store'
import { mapExists } from '../models/maps'
import { checkAllPermissions } from '../permissions/check-permissions'
import { MAP_UPLOADING } from '../../../app/common/flags'
import handleMultipartFiles from '../file-upload/handle-multipart-files'
import ensureLoggedIn from '../session/ensure-logged-in'

export default function(router) {
  router.get('/', ensureLoggedIn, list)
    .post('/upload', ensureLoggedIn, uploadPermissionCheck(), handleMultipartFiles, upload)
    .get('/info/:hash', ensureLoggedIn, getInfo)
}

function uploadPermissionCheck() {
  if (!MAP_UPLOADING) {
    return checkAllPermissions('manageMaps')
  } else {
    return async (ctx, next) => { await next() }
  }
}


async function upload(ctx, next) {
  const { timestamp, hash, extension: anyCaseExtension, filename } = ctx.request.body.fields
  const { path } = ctx.request.body.files.data
  if (await mapExists(hash)) {
    ctx.status = 201
    ctx.body = {}
    return
  }
  const extension = anyCaseExtension.toLowerCase()
  if (extension !== 'scx' && extension !== 'scm') {
    throw new httpErrors.BadRequest('Map must have either .scm or .scx extension')
  }

  await storeMap(hash, extension, filename, timestamp, path)
  ctx.status = 201
  ctx.body = {}
}

async function getInfo(ctx, next) {
  const hash = ctx.params.hash
  const info = (await mapInfo(hash))[0]
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
    limit = 60
  }

  const maps = MAPS.slice(page * limit, (page + 1) * limit)
  const dbInfo = await mapInfo(...maps.map(x => x.hash))
  ctx.body = {
    maps: new Seq(maps).zip(dbInfo).map(([map, info]) => {
      if (info) {
        return {
          // We'll show the map name which is set in maps.json
          // instead of what is actually stored in the map.
          hash: map.hash,
          name: map.name,
          slots: info.slots,
        }
      } else {
        return {
          hash: map.hash,
          name: `(NOT UPLOADED) ${map.name}`,
        }
      }
    }),
    page,
    limit,
    total: MAPS.length,
  }
}
