export function tilesetIdToName(id) {
  if (id > 7) {
    throw new Error('Invalid tileset id')
  }

  return [
    'badlands',
    'platform',
    'installation',
    'ashworld',
    'jungle',
    'desert',
    'ice',
    'twilight',
  ][id]
}

export const SORT_BY_NAME = 0
export const SORT_BY_NUM_OF_PLAYERS = 1
export const SORT_BY_DATE = 2
