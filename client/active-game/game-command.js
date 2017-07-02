export function subscribeToCommands(nydus, socket, id) {
  nydus.subscribeClient(socket, `/game/${id}`)
}

export function sendCommand(nydus, id, command, payload) {
  nydus.publish(`/game/${id}`, {
    command,
    payload,
  })
}
