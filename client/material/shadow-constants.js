export const shadowKeyUmbraOpacity = 0.2
export const shadowKeyPenumbraOpacity = 0.14
export const shadowAmbientOpacity = 0.12

// eslint-disable-next-line max-params
function shadow(depth, uOff, uBlur, uSpread, pOff, pBlur, pSpread, aOff, aBlur, aSpread) {
  return `
    0px ${uOff}px ${uBlur}px ${uSpread}px rgba(0, 0, 0, ${shadowKeyUmbraOpacity}),
    0px ${pOff}px ${pBlur}px ${pSpread}px rgba(0, 0, 0, ${shadowKeyPenumbraOpacity}),
    0px ${aOff}px ${aBlur}px ${aSpread}px rgba(0, 0, 0, ${shadowAmbientOpacity})
  `
}

export const shadowDef1dp = shadow(1, 2, 1, -1, 1, 1, 0, 1, 3, 0)
export const shadowDef2dp = shadow(2, 3, 3, -2, 2, 2, 0, 1, 5, 0)
export const shadowDef3dp = shadow(3, 3, 3, -2, 3, 4, 0, 1, 8, 0)
export const shadowDef4dp = shadow(4, 2, 4, -1, 4, 5, 0, 1, 10, 0)
export const shadowDef5dp = shadow(5, 3, 5, -1, 5, 8, 0, 1, 14, 0)
export const shadowDef6dp = shadow(6, 3, 5, -1, 6, 10, 0, 1, 18, 0)
export const shadowDef7dp = shadow(7, 4, 5, -2, 7, 10, 1, 2, 16, 1)
export const shadowDef8dp = shadow(8, 5, 5, -3, 8, 10, 1, 3, 14, 2)
export const shadowDef9dp = shadow(9, 5, 6, -3, 9, 12, 1, 3, 16, 2)
export const shadowDef10dp = shadow(10, 6, 6, -3, 10, 14, 1, 4, 18, 3)
export const shadowDef11dp = shadow(11, 6, 7, -4, 11, 15, 1, 4, 20, 3)
export const shadowDef12dp = shadow(12, 7, 8, -4, 12, 17, 2, 5, 22, 4)
export const shadowDef13dp = shadow(13, 7, 8, -4, 13, 19, 2, 5, 24, 4)
export const shadowDef14dp = shadow(14, 7, 9, -4, 14, 21, 2, 5, 26, 4)
export const shadowDef15dp = shadow(15, 8, 9, -5, 15, 22, 2, 6, 28, 5)
export const shadowDef16dp = shadow(16, 8, 10, -5, 16, 24, 2, 6, 30, 5)
export const shadowDef17dp = shadow(17, 8, 11, -5, 17, 26, 2, 6, 32, 5)
export const shadowDef18dp = shadow(18, 9, 11, -5, 18, 28, 2, 7, 34, 6)
export const shadowDef19dp = shadow(19, 9, 12, -6, 19, 29, 2, 7, 36, 6)
export const shadowDef20dp = shadow(20, 10, 13, -6, 20, 31, 3, 8, 38, 7)
export const shadowDef21dp = shadow(21, 10, 13, -6, 21, 33, 3, 8, 40, 7)
export const shadowDef22dp = shadow(22, 10, 14, -6, 22, 35, 3, 8, 40, 7)
export const shadowDef23dp = shadow(23, 11, 14, -7, 23, 36, 3, 9, 44, 8)
export const shadowDef24dp = shadow(24, 11, 15, -7, 24, 38, 3, 9, 46, 8)
