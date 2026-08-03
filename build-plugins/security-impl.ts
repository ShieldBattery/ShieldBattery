import type { Plugin } from 'rolldown'

/**
 * Module id the app imports to reach the build's configured client-identification implementation.
 * Kept behind a virtual id because the implementation lives outside the repo and is selected by the
 * build environment, which is not something an import specifier can express.
 */
export const SECURITY_IMPL_ID = 'virtual:sb-security-impl'

const STUB_ID = `\0${SECURITY_IMPL_ID}`

/**
 * Resolves {@link SECURITY_IMPL_ID} to the implementation at `implPath`, or to a stub exporting
 * nothing when no implementation is configured. The importer decides what to do with an absent
 * `collect`.
 */
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
        return 'export const collect = undefined'
      },
    },
  }
}
