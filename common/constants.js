// common constants, shared between multiple pieces of code (and likely client and server)

export const EMAIL_PATTERN = /^[^@]+@[^@]+$/
export const EMAIL_MINLENGTH = 3
export const EMAIL_MAXLENGTH = 100

export const LOBBY_NAME_MAXLENGTH = 50

export const PASSWORD_MINLENGTH = 6

export const USERNAME_PATTERN = /^[A-Za-z0-9`~!$^&*()[\]\-_+=.{}]+$/
export const USERNAME_MINLENGTH = 1
export const USERNAME_MAXLENGTH = 16

export const CHANNEL_PATTERN = /^[A-Za-z0-9`~!$^&*()[\]\-_+=.{}|?<>:;,'"]+$/
export const CHANNEL_MAXLENGTH = 64

export const MATCHMAKING_ACCEPT_MATCH_TIME = 15000
export const MATCHMAKING_TYPE_1V1 = '1v1'
export const MATCHMAKING_TYPES = [MATCHMAKING_TYPE_1V1]

export const STARCRAFT_DOWNLOAD_URL = 'https://us.battle.net/account/download/?show=classic'

export const GAME_TYPES = ['melee', 'ffa', 'topVBottom', 'teamMelee', 'teamFfa', 'ums', 'oneVOne']

export const MAP_VISIBILITY_OFFICIAL = 'OFFICIAL'
export const MAP_VISIBILITY_PRIVATE = 'PRIVATE'
export const MAP_VISIBILITY_PUBLIC = 'PUBLIC'

export function isValidUsername(username) {
  return (
    username &&
    username.length >= USERNAME_MINLENGTH &&
    username.length <= USERNAME_MAXLENGTH &&
    USERNAME_PATTERN.test(username)
  )
}

export function isValidEmail(email) {
  return (
    email &&
    email.length >= EMAIL_MINLENGTH &&
    email.length <= EMAIL_MAXLENGTH &&
    EMAIL_PATTERN.test(email)
  )
}

export function isValidPassword(password) {
  return password && password.length >= PASSWORD_MINLENGTH
}

export function isValidChannelName(channel) {
  return channel && channel.length <= CHANNEL_MAXLENGTH && CHANNEL_PATTERN.test(channel)
}

export function isValidLobbyName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= LOBBY_NAME_MAXLENGTH
}

export function isValidGameType(type) {
  return GAME_TYPES.includes(type)
}

export function isValidGameSubType(type) {
  return type => !type || (type >= 1 && type <= 7)
}

export function isValidMatchmakingType(type) {
  return MATCHMAKING_TYPES.includes(type)
}

export function validRace(r) {
  return r === 'r' || r === 't' || r === 'z' || r === 'p'
}
