import koaBody from 'koa-body'
import fs from 'fs'

const bodyMiddleware = koaBody({
  multipart: true,
  formidable: {
    /**
     * NOTE(tec27): if you change this, ensure our nginx config has a larger size for
     * client_max_body_size
     */
    maxFileSize: 50 * 1024 * 1024,
  },
})

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
