// These are the Material palette colors with our brand colors removed,
// filtered to 100, 300, 500, and 700 shades. Colors that don't work well on
// dark backgrounds have also been removed.
const COLORS = [
  // Red
  '#ffcdd2',
  '#e57373',
  '#f44336',
  '#d32f2f',

  // Pink
  '#f8bbd0',
  '#f06292',
  '#e91e63',
  '#c2185b',

  // Deep Purple
  '#d1c4e9',
  '#9575cd',
  '#673ab7',

  // Indigo
  '#c5cae9',
  '#7986cb',
  '#3f51b5',
  '#303f9f',

  // Light Blue
  '#b3e5fc',
  '#4fc3f7',
  '#03a9f4',
  '#0288d1',

  // Cyan
  '#b2ebf2',
  '#4dd0e1',
  '#00bcd4',
  '#0097a7',

  // Teal
  '#b2dfdb',
  '#4db6ac',
  '#009688',
  '#00796b',

  // Green
  '#c8e6c9',
  '#81c784',
  '#4caf50',
  '#388e3c',

  // Light Green
  '#dcedc8',
  '#aed581',
  '#8bc34a',
  '#689f38',

  // Yellow
  '#fff9c4',
  '#fff176',
  '#ffeb3b',
  '#fbc02d',

  // Orange
  '#ffe0b2',
  '#ffb74d',
  '#ff9800',
  '#f57c00',

  // Deep Orange
  '#ffccbc',
  '#ff8a65',
  '#ff5722',
  '#e64a19',

  // Brown
  '#d7ccc8',
  '#a1887f',
  '#795548',
].sort()

function hashStr(str) {
  if (!str) return 0
  let result = 0
  for (let i = 0; i < str.length; i++) {
    result += (result << 5) + str.charCodeAt(i)
    result = result | 0
  }
  return result
}

export function randomColorForString(str) {
  const hashCode = hashStr(str)
  return COLORS[hashCode % COLORS.length]
}
