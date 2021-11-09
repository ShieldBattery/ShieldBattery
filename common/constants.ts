// common constants, shared between multiple pieces of code (and likely client and server)

export const EMAIL_PATTERN = /^[^@]+@[^@]+$/
export const EMAIL_MINLENGTH = 3
export const EMAIL_MAXLENGTH = 100

export const LOBBY_NAME_MAXLENGTH = 50

export const PASSWORD_MINLENGTH = 6

export const USERNAME_ALLOWED_CHARACTERS = String.raw`[A-Za-z0-9\`~!$^&*()[\]\-_+=.{}]+`
export const USERNAME_PATTERN = new RegExp(String.raw`^${USERNAME_ALLOWED_CHARACTERS}$`)
export const USERNAME_MINLENGTH = 1
export const USERNAME_MAXLENGTH = 16

export const CHANNEL_PATTERN = /^[A-Za-z0-9`~!$^&*()[\]\-_+=.{}|?<>:;,'"]+$/
export const CHANNEL_MAXLENGTH = 64

export const STARCRAFT_DOWNLOAD_URL = 'https://us.battle.net/account/download/?show=classic'

export function isValidUsername(username: string): boolean {
  return !!(
    username &&
    username.length >= USERNAME_MINLENGTH &&
    username.length <= USERNAME_MAXLENGTH &&
    USERNAME_PATTERN.test(username)
  )
}

export function isValidEmail(email: string): boolean {
  return !!(
    email &&
    email.length >= EMAIL_MINLENGTH &&
    email.length <= EMAIL_MAXLENGTH &&
    EMAIL_PATTERN.test(email)
  )
}

export function isValidPassword(password: string): boolean {
  return !!(password && password.length >= PASSWORD_MINLENGTH)
}

export function isValidChannelName(channel: string): boolean {
  return !!(channel && channel.length <= CHANNEL_MAXLENGTH && CHANNEL_PATTERN.test(channel))
}

export function isValidLobbyName(name: string): boolean {
  return typeof name === 'string' && name.length > 0 && name.length <= LOBBY_NAME_MAXLENGTH
}

export function validRace(r: string): boolean {
  return r === 'r' || r === 't' || r === 'z' || r === 'p'
}
