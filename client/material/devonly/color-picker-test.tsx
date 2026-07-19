import { useState } from 'react'
import styled from 'styled-components'
import { SC_COLORS } from '../../../common/settings/team-colors'
import { bodyMedium, titleSmall } from '../../styles/typography'
import { Card } from '../card'
import { ColorPickerSwatch, getColorLabel, nextUnusedColor } from '../color-picker'
import { ColorPoolEditor } from '../color-pool-editor'
import { EditableColorSwatch } from '../editable-color-swatch'

const SWATCHES: ReadonlyArray<ColorPickerSwatch> = SC_COLORS.map(c => ({
  color: c.hex,
  label: c.name,
}))

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  padding: 24px;
`

const StyledCard = styled(Card)`
  width: 100%;
  max-width: 640px;
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const SectionTitle = styled.h3`
  ${titleSmall};
`

const Description = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

/**
 * Exercises `EditableColorSwatch` (both a required-value swatch and an optional/clearable one)
 * and `ColorPoolEditor` (add/remove/drag-reorder) against local mock state.
 */
export function ColorPickerTest() {
  const [singleColor, setSingleColor] = useState('#2CB494')
  const [optionalColor, setOptionalColor] = useState<string | undefined>(undefined)
  const [pool, setPool] = useState<string[]>(['#F40404', '#0C48CC', '#2CB494'])

  return (
    <Container>
      <StyledCard>
        <SectionTitle>Single swatch</SectionTitle>
        <Description>
          Current value: {singleColor} ({getColorLabel(singleColor)})
        </Description>
        <EditableColorSwatch
          value={singleColor}
          defaultValue={singleColor}
          onChange={hex => {
            if (hex !== undefined) setSingleColor(hex)
          }}
          editable={true}
          swatches={SWATCHES}
          pickerSubtitle='Devonly · single swatch'
          label={getColorLabel(singleColor)}
          addLabel=''
        />
      </StyledCard>

      <StyledCard>
        <SectionTitle>Optional swatch (clearable)</SectionTitle>
        <Description>Current value: {optionalColor ?? 'unset'}</Description>
        <EditableColorSwatch
          value={optionalColor}
          defaultValue='#00E4FC'
          onChange={setOptionalColor}
          editable={true}
          swatches={SWATCHES}
          pickerSubtitle='Devonly · optional swatch'
          label={optionalColor ? getColorLabel(optionalColor) : ''}
          addLabel='Add a color'
        />
      </StyledCard>

      <StyledCard>
        <SectionTitle>Pool row editor</SectionTitle>
        <Description>{pool.length} colors</Description>
        <ColorPoolEditor
          colors={pool}
          editable={true}
          minLength={1}
          maxLength={8}
          swatches={SWATCHES}
          colorLabel={getColorLabel}
          getPickerSubtitle={index => `Devonly · pool · #${index + 1}`}
          addLabel='Add a color'
          removeLabel='Remove color'
          hint='Click a swatch to change it, drag to reorder.'
          onSwatchChange={(index, hex) => {
            const next = pool.slice()
            next[index] = hex
            setPool(next)
          }}
          onRemove={index => {
            const next = pool.slice()
            next.splice(index, 1)
            setPool(next)
          }}
          onReorder={(from, to) => {
            const next = pool.slice()
            const [item] = next.splice(from, 1)
            next.splice(to, 0, item)
            setPool(next)
          }}
          onAdd={() => setPool([...pool, nextUnusedColor(pool)])}
        />
      </StyledCard>
    </Container>
  )
}
