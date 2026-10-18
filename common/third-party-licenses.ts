/**
 * A third-party package whose code ships in one of our bundles, as recorded at build time by
 * `build-plugins/third-party-licenses.ts`.
 */
export interface ThirdPartyPackage {
  name: string
  version: string
  /** The SPDX license expression the package declares. */
  license: string
  /** Where the package's source lives, if it says. */
  repository?: string
  /**
   * The package's own license and notice files, verbatim. Empty for a package that ships none, in
   * which case `license` is all there is to go on.
   */
  licenseFiles: Array<{ fileName: string; text: string }>
}

/** The license data a single bundle build writes out, sorted by package name. */
export interface ThirdPartyLicensesFile {
  /** Which build this describes, e.g. `web` or `app-main`. */
  build: string
  packages: ThirdPartyPackage[]
}
