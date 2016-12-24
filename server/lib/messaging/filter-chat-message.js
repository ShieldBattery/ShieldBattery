export default function filterChatMessage(msg) {
  return msg.length > 500 ? msg.slice(0, 500) : msg
}
