export function isUms(gameType) {
  return gameType === 'ums'
}

// Since we don't keep a separate list just for the slots, this function iterates over all of the
// teams in a lobby and accumulates the slots into a new list. Keep in mind that you lose the team
// index and slot index, so use this function only when you care about the slots themselves, not
// their indexes; otherwise, use the `getLobbySlotsWithIndexes`.
export function getLobbySlots(lobby) {
  return lobby.teams.flatMap(team => team.slots)
}

// Gets all the player slots for a lobby, which for now are: `human`, `computer` and `umsComputer`
// type slots.
export function getPlayerSlots(lobby) {
  return getLobbySlots(lobby).filter(
    slot => slot.type === 'human' || slot.type === 'computer' || slot.type === 'umsComputer',
  )
}

// Gets all the human slots in a lobby. This includes both the players and the observers.
export function getHumanSlots(lobby) {
  return getLobbySlots(lobby).filter(slot => slot.type === 'human' || slot.type === 'observer')
}

// This function is similar to the `getLobbySlots`, only it preserves the team index and slot index
// after flat mapping the team, and as a result returns an immutable list where each element is in
// the following form: [teamIndex, slotIndex, slot]
export function getLobbySlotsWithIndexes(lobby) {
  return lobby.teams.flatMap((team, teamIndex) =>
    team.slots.map((slot, slotIndex) => [teamIndex, slotIndex, slot]),
  )
}

// Like getLobbySlotsWithIndexes, but includes the possible UMS hidden slots that are necessary
// in game initialization
export function getIngameLobbySlotsWithIndexes(lobby) {
  return lobby.teams.flatMap((team, teamIndex) =>
    team.slots.concat(team.hiddenSlots).map((slot, slotIndex) => [teamIndex, slotIndex, slot]),
  )
}

// Finds the slot with the specified name in the lobby. Only works for `human` type slots (other
// type of slots do not have unique names). Returns the [teamIndex, slotIndex, slot] list if the
// player is found; otherwise returns an empty list.
export function findSlotByName(lobby, name) {
  const slot = getLobbySlotsWithIndexes(lobby).find(
    ([, , slot]) => (slot.type === 'human' || slot.type === 'observer') && slot.name === name,
  )
  return slot ? slot : []
}

// Finds the slot with the specified id in the lobby. Returns the [teamIndex, slotIndex, slot] list
// if the slot is found; otherwise returns an empty list.
export function findSlotById(lobby, id) {
  const slot = getLobbySlotsWithIndexes(lobby).find(([, , slot]) => slot.id === id)
  return slot ? slot : []
}

// Utility function that returns the total number of slots for a particular lobby. This function
// excludes the observer team
export function slotCount(lobby) {
  return lobby.teams
    .filterNot(team => team.isObserver)
    .reduce((slots, team) => slots + team.slots.size, 0)
}

// Utility function that returns the number of `human` type slots for a particular lobby. Useful for
// determining if the lobby should be closed for example if there are no human players in it.
export function humanSlotCount(lobby) {
  return lobby.teams.reduce(
    (humanSlots, team) =>
      humanSlots + team.slots.count(slot => slot.type === 'human' || slot.type === 'observer'),
    0,
  )
}

// Utility function that returns the number of "player" slots for a particular team, ie. are
// considered when determining if the game can start.
// Player slot types for now are: `human`, `computer`, `umsComputer`
export function teamPlayerSlotCount(team) {
  return team.slots.count(
    slot => slot.type === 'human' || slot.type === 'computer' || slot.type === 'umsComputer',
  )
}

// Utility function that returns the number of "taken" slots for a particular lobby, ie. all the
// slots that are not `open` or `controlledOpen`. This function excludes the observer team.
export function takenSlotCount(lobby) {
  return lobby.teams
    .filterNot(team => team.isObserver)
    .reduce(
      (takenSlots, team) =>
        takenSlots +
        team.slots.count(slot => slot.type !== 'open' && slot.type !== 'controlledOpen'),
      0,
    )
}

// Utility function that returns the number of "taken" slots for a particular team, ie. all the
// slots that are not `open` or `controlledOpen`.
export function teamTakenSlotCount(team) {
  return team.slots.count(slot => slot.type !== 'open' && slot.type !== 'controlledOpen')
}

// Utility function that returns the number of "open" slots for a particular lobby, ie. available
// for someone to join in. Open slot types for now are: `open`, `controlledOpen`
export function openSlotCount(lobby) {
  return lobby.teams.reduce(
    (openSlots, team) =>
      openSlots + team.slots.count(slot => slot.type === 'open' || slot.type === 'controlledOpen'),
    0,
  )
}

// Checks if the given `gameType` is a "team" type, meaning that a user can select the configuration
// of the slots when creating a lobby. It's also used to determine the `teamId` property of each
// team/slot, as well as calculating if the lobby has opposing sides ("team" types have different
// logic to do this compared to "non-team" types).
export function isTeamType(gameType) {
  switch (gameType) {
    case 'melee':
      return false
    case 'ffa':
      return false
    case 'oneVOne':
      return false
    case 'ums':
      return false
    case 'teamMelee':
      return true
    case 'teamFfa':
      return true
    case 'topVBottom':
      return true
    default:
      throw new Error('Unknown game type: ' + gameType)
  }
}

// Returns whether or not a lobby has 2 or more opposing sides (and thus would be suitable for
// starting a game from)
export function hasOpposingSides(lobby) {
  return !isTeamType(lobby.gameType)
    ? getPlayerSlots(lobby).size > 1
    : lobby.teams.filter(team => !team.isObserver && teamPlayerSlotCount(team) > 0).size > 1
}

// Returns true if the lobby has an observer team; false otherwise.
export function hasObservers(lobby) {
  return lobby.teams.reduce((hasObserver, team) => hasObserver || team.isObserver, false)
}

// Returns a [teamIndex, team] tuple if the observer team is found. Should usually be used in
// conjunction with the `hasObserver` function, so you're sure there is an observer team.
export function getObserverTeam(lobby) {
  return lobby.teams.map((team, teamIndex) => [teamIndex, team]).find(([, team]) => team.isObserver)
}

// Checks whether a particular slot is inside the observer team
export function isInObserverTeam(lobby, slot) {
  const [, observerTeam] = getObserverTeam(lobby)
  return observerTeam.slots.find(s => s.id === slot.id)
}

// Checks if the lobby has any slots that can be made observers.
export function canAddObservers(lobby) {
  const [, observerTeam] = getObserverTeam(lobby)
  return observerTeam && observerTeam.slots.size < 6
}

// Checks if the lobby has space for moving observers to players
export function canRemoveObservers(lobby) {
  return (
    lobby.teams.find(team => {
      return !team.isObserver && team.slots.size !== team.originalSize
    }) !== undefined
  )
}
