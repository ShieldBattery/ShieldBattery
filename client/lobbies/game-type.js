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

export function isTeamType(gameType) {
  switch (gameType) {
    case 'melee': return false
    case 'ffa': return false
    case 'oneVOne': return false
    case 'ums': return false
    case 'teamMelee': return true
    case 'teamFfa': return true
    case 'topVBottom': return true
    default: throw new Error('Unknown game type: ' + gameType)
  }
}
