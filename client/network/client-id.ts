import { nanoid } from 'nanoid'

/**
 * A random, unique value that is generated on every page load. This value is used by our
 * websocket connection to identify individual app instances across reconnects.
 */
export const clientId = nanoid()
