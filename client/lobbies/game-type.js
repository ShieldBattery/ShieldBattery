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

// This function is probably unnecessary since we can just check if lobby.teams.size === 1, or at
// the very least replace it with that. However, once we add support for observers, it might
// complicate things. Because then each lobby might have an additional team for observers, but it
// also might not if there is no space for observers (eg. 8-player map). Another awkward thing about
// this function is that it returns false for 'ums' type, which is a problem since we use this
// function to determine whether to display the team names in the lobby, which 'ums' obviously
// should.
// TODO(2Pac): revisit this function once we add observer support and ums support
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
