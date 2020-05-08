export default function () {
  return async function csrfCookie(ctx, next) {
    await next()
    ctx.cookies.set('XSRF-TOKEN', ctx.csrf, { httpOnly: false })
  }
}
