import whisper from './whisper'

export const aliasCommandMap = new Map()

const handlers = [
  whisper,
]

export default function register() {
  for (const handler of handlers) {
    handler(aliasCommandMap)
  }
}
