/** The named pipes the Discord desktop app listens on for local clients like the Discord SDK. */
const DISCORD_IPC_PIPE = /^discord-ipc-\d$/

/** Returns whether a listing of the Windows pipe namespace includes the Discord desktop app's. */
export function hasDiscordIpcPipe(pipeNames: ReadonlyArray<string>): boolean {
  return pipeNames.some(name => DISCORD_IPC_PIPE.test(name))
}
