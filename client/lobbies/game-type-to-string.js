export default function (gameType) {
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
    case 'oneVOne':
      return 'One on one'
    default:
      return 'Unknown'
  }
}
