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

export function slotsPerTeam(gameType, gameSubType) {
  if (!isTeamType(gameType)) {
    return 8
  } else if (gameType === 'topVBottom') {
    return gameSubType
  } else {
    switch (gameSubType) {
      case 4: return 2
      case 3: return 3
      default: return 4
    }
  }
}

export function numTeams(gameType, gameSubType) {
  if (!isTeamType(gameType)) {
    return 0
  } else if (gameType === 'topVBottom') {
    return 2
  } else {
    return gameSubType
  }
}

export function getTeamName(gameType, teamNum) {
  if (gameType === 'topVBottom') {
    return teamNum === 0 ? 'Top' : 'Bottom'
  } else {
    return `Team ${teamNum + 1}`
  }
}
