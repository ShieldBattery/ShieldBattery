import koaBody from 'koa-body'
import fs from 'fs'

const bodyMiddleware = koaBody({ multipart: true })

// A Koa middleware function that sets up multipart file handling and will clean up the files
// once the request is completed
export default async function handleMultipartFiles(ctx, next) {
  await bodyMiddleware(ctx, async () => {
    try {
      await next()
    } finally {
      for (const { path } of Object.values(ctx.request.files)) {
        fs.unlink(path, e => {})
      }
    }
  })
}
