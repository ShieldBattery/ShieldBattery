/**
 * The client-identification implementation the build was configured with. Resolved by a build
 * plugin, since the implementation lives outside the repo and is selected by the build
 * environment.
 */
declare module 'virtual:sb-security-impl' {
  /** Undefined when the build configured no implementation. */
  export const collect: typeof import('../app/security/client').collect | undefined
}
