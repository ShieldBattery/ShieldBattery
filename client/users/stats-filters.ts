/**
 * Sentinel values for the Stats tab's filter dropdowns, shared so the "everything" option means
 * the same thing in each of them.
 *
 * All three are `'all'` rather than something readable: a map sentinel spelled like a display
 * name (`'Overall'`) is a value a real map could legitimately have, and a map called Overall
 * would then be indistinguishable from the option that means every map.
 */

export const ALL_SEASONS = 'all'
export const ALL_MODES = 'all'
export const ALL_MAPS = 'all'
