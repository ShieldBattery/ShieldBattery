import type { Plugin } from 'rolldown'

export const SECURITY_IMPL_ID = 'virtual:sb-security-impl'

const STUB_ID = `\0${SECURITY_IMPL_ID}`

export function securityImpl(implPath: string | undefined): Plugin {
  return {
    name: 'sb:security-impl',

    resolveId: {
      filter: { id: new RegExp(`^${SECURITY_IMPL_ID}$`) },
      handler() {
        return implPath ?? STUB_ID
      },
    },

    load: {
      filter: { id: new RegExp(`^\0${SECURITY_IMPL_ID}$`) },
      handler() {
        return 'export const collect = undefined; export const collectRequest = undefined; export const verifyGame = undefined; export const verifyGameConnection = undefined'
      },
    },
  }
}
