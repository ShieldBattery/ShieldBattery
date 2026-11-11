declare module 'virtual:sb-security-impl' {
  export const collect: typeof import('../app/security/client').collect | undefined
  export const collectRequest:
    | ((
        nonce: string,
        requestHash: string,
        installPath?: string,
      ) => Promise<import('../common/users/client-proof').ClientProof>)
    | undefined
  export const verifyGame:
    | ((filename: string, executable: string, logError?: (msg: string) => void) => Promise<void>)
    | undefined
  export const verifyGameConnection:
    | ((
        directory: string,
        serverPort: number,
        clientPort: number,
        logError?: (msg: string) => void,
      ) => Promise<boolean | undefined>)
    | undefined
}
