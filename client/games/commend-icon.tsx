import { MaterialIcon } from '../icons/material/material-icon'

/**
 * The icon for commends everywhere they appear. Callers color it (normally `--theme-amber`). Keep it
 * at 18px or larger: the handshake glyph loses its shape below that.
 */
export function CommendIcon({ size, className }: { size?: number; className?: string }) {
  return <MaterialIcon icon='handshake' size={size} className={className} />
}
