/** How far above the message list's bottom edge the floating jump-to-bottom button's own bottom sits. */
export const JUMP_TO_BOTTOM_OFFSET_PX = 12
/** The floating jump-to-bottom button's height: a standard 40px button. */
export const JUMP_TO_BOTTOM_HEIGHT_PX = 40
/**
 * How far up from the bottom of the message list the floating jump-to-bottom button reaches. Anything
 * rendered at the list's newer edge that has to stay readable and clickable while the button is showing
 * needs at least this much clearance below it.
 */
export const JUMP_TO_BOTTOM_CLEARANCE_PX = JUMP_TO_BOTTOM_OFFSET_PX + JUMP_TO_BOTTOM_HEIGHT_PX
