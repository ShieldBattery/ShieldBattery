import styled from 'styled-components'

/* Primary color */
export const blue50 = '#e3f2fd'
export const blue100 = '#bbdefb'
export const blue200 = '#90caf9'
export const blue300 = '#64b5f6'
export const blue400 = '#42a5f5'
export const blue500 = '#2196f3'
export const blue600 = '#1e88e5'
export const blue700 = '#1976d2'
export const blue800 = '#1565c0'
export const blue900 = '#0d47a1'

/* Accent color */
export const amberA100 = '#ffe57f'
export const amberA200 = '#ffd740'
export const amberA400 = '#ffc400'
export const amberA700 = '#ffab00'

/* Greys (for backgrounds) */
export const grey50 = '#F5FBFE'
export const grey100 = '#EBF1FA'
export const grey200 = '#E0E7F0'
export const grey300 = '#D3DAE4'
export const grey400 = '#B2BBC7'
export const grey500 = '#9198A1'
export const grey600 = '#68717C'
export const grey700 = '#505762'
export const grey800 = '#353D45'
export const grey850 = '#252A31'
export const grey900 = '#1B1E22'

export const alphaDividers = '0.12'
export const alphaDisabled = '0.5'
export const alphaSecondary = '0.7'
export const alphaPrimary = '1.0'

export const colorText = '#ffffff'

export const colorDividers = `rgba(255, 255, 255, ${alphaDividers})`
export const colorTextFaint = `rgba(255, 255, 255, ${alphaDisabled})`
export const colorTextSecondary = `rgba(255, 255, 255, ${alphaSecondary})`
export const colorTextPrimary = `rgba(255, 255, 255, ${alphaPrimary})`

export const colorBackground = grey900
export const colorError = '#ff6e6e'
export const colorSuccess = '#66bb6a'

export const dialogScrim = grey900

export const CardLayer = styled.div`
  background-color: ${grey800};
`
