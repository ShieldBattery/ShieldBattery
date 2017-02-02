export const GAME_TYPES = [
  'melee',
  'ffa',
  'topVBottom',
  'teamMelee',
  'teamFfa',
]

export function gameTypeToString(gameType) {
  switch (gameType) {
    case 'melee': return 'Melee'
    case 'ffa': return 'Free for all'
    case 'topVBottom': return 'Top vs bottom'
    case 'teamMelee': return 'Team melee'
    case 'teamFfa': return 'Team free for all'
    default: return 'Unknown'
  }
}
