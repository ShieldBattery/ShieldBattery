// Exporting this from its own file to prevent circular dependencies in two files that use it.
export const baseUrl =
  IS_ELECTRON && window.SHIELDBATTERY_ELECTRON_API?.env?.SB_SERVER
    ? window.SHIELDBATTERY_ELECTRON_API.env.SB_SERVER
    : __WEBPACK_ENV.SB_SERVER
