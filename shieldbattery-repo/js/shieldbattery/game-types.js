const MELEE = 0x02
const FFA = 0x03
const ONE_V_ONE = 0x04
const CAPTURE_THE_FLAG = 0x05 // eslint-disable-line no-unused-vars
const GREED = 0x06 // eslint-disable-line no-unused-vars
const SLAUGHTER = 0x07 // eslint-disable-line no-unused-vars
const SUDDEN_DEATH = 0x08 // eslint-disable-line no-unused-vars
const LADDER = 0x09 // eslint-disable-line no-unused-vars
const UMS = 0x0A
const TEAM_MELEE = 0x0B
const TEAM_FFA = 0x0C
const TEAM_CAPTURE_THE_FLAG = 0x0D // eslint-disable-line no-unused-vars
const TOP_V_BOTTOM = 0x0F

function gameType(main, sub = 0x01) {
  return main | (sub << 16)
}

export const melee = () => gameType(MELEE)
export const ffa = () => gameType(FFA)
export const oneVOne = () => gameType(ONE_V_ONE)
export const ums = () => gameType(UMS)
export const teamMelee = numTeams => gameType(TEAM_MELEE, numTeams - 1)
export const teamFfa = numTeams => gameType(TEAM_FFA, numTeams - 1)
export const topVBottom = numOnTop => gameType(TOP_V_BOTTOM, numOnTop)
