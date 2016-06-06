export default function pickServer(pingsA, pingsB) {
  let minIndex = -1
  let minPing = Number.MAX_VALUE
  for (let i = 0; i < pingsA.length; i++) {
    if (pingsA[i] === undefined || pingsB[i] === undefined) continue

    const ping = pingsA[i] + pingsB[i]
    if (ping < minPing) {
      minIndex = i
      minPing = ping
    }
  }

  return minIndex
}
