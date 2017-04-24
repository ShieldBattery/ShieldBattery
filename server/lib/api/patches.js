import fs from 'fs'
import httpErrors from 'http-errors'
import handleMultipartFiles from '../file-upload/handle-multipart-files'
import { checkAllPermissions } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'
import { writeFile, getUrl } from '../file-upload'
import { addPatch, patchExists } from '../models/starcraft-patches'

export default function(router) {
  router
    .post('/', ensureLoggedIn,
        checkAllPermissions('manageStarcraftPatches'), handleMultipartFiles, uploadPatch)
    .get('/:filename/:hash', getPatchInfo)
}

function patchPath(hash, filename) {
  return `starcraft_patches/${filename.toLowerCase()}-${hash.toLowerCase()}`
}

async function uploadPatch(ctx, next) {
  const { hash, filename, description } = ctx.request.body.fields
  const { path } = ctx.request.body.files.diff

  if (!hash) {
    throw new httpErrors.BadRequest('hash must be specified')
  } else if (!filename) {
    throw new httpErrors.BadRequest('filename must be specified')
  } else if (!description) {
    throw new httpErrors.BadRequest('description must be specified')
  } else if (!path) {
    throw new httpErrors.BadRequest('diff file must be specified')
  }

  const exists = await patchExists(hash, filename)
  if (exists) {
    ctx.status = 204
    return
  }

  await addPatch(hash, filename, description,
      () => writeFile(patchPath(hash, filename),
          fs.createReadStream(path)))
  ctx.status = 204
}

async function getPatchInfo(ctx, next) {
  const { hash, filename } = ctx.params

  const exists = await patchExists(hash, filename)
  if (!exists) {
    throw new httpErrors.NotFound('Unrecognized file version')
  }

  ctx.body = {
    url: await getUrl(patchPath(hash, filename))
  }
}
