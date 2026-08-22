import { CHAT_MESSAGE_MAXLENGTH } from '../../../common/constants'

export default function filterChatMessage(msg: string): string {
  return msg.length > CHAT_MESSAGE_MAXLENGTH ? msg.slice(0, CHAT_MESSAGE_MAXLENGTH) : msg
}
