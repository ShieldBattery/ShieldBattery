import { isElectronClient } from '../network/only-web-clients'

export default function (ctx) {
  ctx.cookies.set('returning', 'true', {
    maxAge: 10 * 365 * 24 * 60 * 60 * 1000,
    httpOnly: false,
    sameSite: isElectronClient(ctx) ? 'none' : 'lax',
  })
}
