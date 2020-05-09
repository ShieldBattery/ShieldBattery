export default function () {
  return async function csrfCookie(ctx, next) {
    await next()
    // NOTE(tec27): CSRF only matters for non-GET requests so `SameSite: strict` is fine. Also note
    // that SameSite itself mostly protects against the same attacks so maybe we can just remove
    // this now? Not really harming anything at the moment so I've left it in place.
    ctx.cookies.set('XSRF-TOKEN', ctx.csrf, { httpOnly: false, sameSite: 'strict' })
  }
}
