import crypto from 'crypto'
import isDev from '../env/is-dev'

const CSP_NONCE_VALUE = Symbol('cspNonceValue')

// Get the Content Security Policy nonce for a given Koa context. If a policy has not yet been
// attached, one will be generated and applied.
export function getCspNonce(ctx) {
  if (ctx[CSP_NONCE_VALUE]) {
    return ctx[CSP_NONCE_VALUE]
  }

  const nonce = crypto.randomBytes(16).toString('base64')
  // If hot-reloading is on, we have to allow eval so it can work
  const scriptEvalPolicy = isDev ? "'unsafe-eval'" : ''

  const policy =
    `script-src 'self' 'nonce-${nonce}' ${scriptEvalPolicy};` +
    `style-src 'self' 'nonce-${nonce}' https://fonts.googleapis.com;` +
    "font-src 'self' https://fonts.gstatic.com;"
  ctx.set('Content-Security-Policy', policy)

  ctx[CSP_NONCE_VALUE] = nonce
  return nonce
}
