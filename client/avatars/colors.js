
// These are the Material palette colors with our brand colors and the 50 and 900 swatches removed
// (to avoid  confusion/clashing, and to avoid really dark shades that won't read well)
const COLORS = [
  // Red
  '#ffcdd2', '#ef9a9a', '#e57373', '#ef5350',
  '#f44336', '#e53935', '#d32f2f', '#c62828',

  // Pink
  '#f8bbd0', '#f48fb1', '#f06292', '#ec407a',
  '#e91e63', '#d81b60', '#c2185b', '#ad1457',

  // Deep Purple
  '#d1c4e9', '#b39ddb', '#9575cd', '#7e57c2',
  '#673ab7', '#5e35b1', '#512da8', '#4527a0',

  // Indigo
  '#c5cae9', '#9fa8da', '#7986cb', '#5c6bc0',
  '#3f51b5', '#3949ab', '#303f9f', '#283593',

  // Light Blue
  '#b3e5fc', '#81d4fa', '#4fc3f7', '#29b6f6',
  '#03a9f4', '#039be5', '#0288d1', '#0277bd',

  // Cyan
  '#b2ebf2', '#80deea', '#4dd0e1', '#26c6da',
  '#00bcd4', '#00acc1', '#0097a7', '#00838f',

  // Teal
  '#b2dfdb', '#80cbc4', '#4db6ac', '#26a69a',
  '#009688', '#00897b', '#00796b', '#00695c',

  // Green
  '#c8e6c9', '#a5d6a7', '#81c784', '#66bb6a',
  '#4caf50', '#43a047', '#388e3c', '#2e7d32',

  // Light Green
  '#dcedc8', '#c5e1a5', '#aed581', '#9ccc65',
  '#8bc34a', '#7cb342', '#689f38', '#558b2f',

  // Yellow
  '#fff9c4', '#fff59d', '#fff176', '#ffee58',
  '#ffeb3b', '#fdd835', '#fbc02d', '#f9a825',

  // Orange
  '#ffe0b2', '#ffcc80', '#ffb74d', '#ffa726',
  '#ff9800', '#fb8c00', '#f57c00', '#ef6c00',

  // Deep Orange
  '#ffccbc', '#ffab91', '#ff8a65', '#ff7043',
  '#ff5722', '#f4511e', '#e64a19', '#d84315',

  // Brown
  '#d7ccc8', '#bcaaa4', '#a1887f', '#8d6e63',
  '#795548', '#6d4c41', '#5d4037', '#4e342e',

  // Blue Grey
  '#cfd8dc', '#b0bec5', '#90a4ae', '#78909c',
  '#607d8b', '#546e7a', '#455a64', '#37474f',
]

function hashStr(str) {
  if (!str) return 0
  let result = 0
  for (const c of str) {
    result += (result << 5) + c.charCodeAt(0)
  }
  return result >>> 0
}

export function randomColorForString(str) {
  const hashCode = hashStr(str)
  return COLORS[hashCode % COLORS.length]
}
