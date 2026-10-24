/**
 * Decodes a base64 bitmask of changed build tiles (1 bit per tile, row-major, low bit first in each
 * byte) into the indexes of the set tiles. Bits past `tileCount` are ignored.
 */
export function decodeTerrainChanges(encoded: string, tileCount: number): number[] {
  const binary = atob(encoded)
  const changed: number[] = []
  const limit = Math.min(tileCount, binary.length * 8)
  for (let i = 0; i < limit; i++) {
    if (binary.charCodeAt(i >> 3) & (1 << (i & 7))) {
      changed.push(i)
    }
  }
  return changed
}
