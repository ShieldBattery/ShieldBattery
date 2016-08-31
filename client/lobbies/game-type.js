export function gameTypeToString(gameType) {
  switch (gameType) {
    case 'melee': return 'Melee'
    case 'ffa': return 'Free for all'
    default: return 'Unknown'
  }
}
