export const GAME_TYPES = ['melee', 'ffa', 'topVBottom', 'teamMelee', 'teamFfa', 'ums']

export function gameTypeToString(gameType) {
  switch (gameType) {
    case 'melee':
      return 'Melee'
    case 'ffa':
      return 'Free for all'
    case 'topVBottom':
      return 'Top vs bottom'
    case 'teamMelee':
      return 'Team melee'
    case 'teamFfa':
      return 'Team free for all'
    case 'ums':
      return 'Use map settings'
    default:
      return 'Unknown'
  }
}
