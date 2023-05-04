export const zIndexWindowControls = 120
export const zIndexTooltip = 110
export const zIndexMenu = 109
export const zIndexMenuBackdrop = 108
export const zIndexDialog = 100
// NOTE(2Pac): It's ok this is the same value as z-index of the dialog itself, since the same
// component controls both of them, and their DOM ordering is pretty guaranteed. While also allowing
// us to display the scrim above the non-top dialogs in case more than one are open.
export const zIndexDialogScrim = 100
export const zIndexSnackbar = 90
export const zIndexBottomSheet = 80
export const zIndexScrollMask = 75
export const zIndexSideNav = 70
export const zIndexBackdrop = 60
export const zIndexFab = 40
export const zIndexAppBar = 30
export const zIndexSettings = 25
