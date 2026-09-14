import styled from 'styled-components'
import { GameDefaultsPreset } from '../../../common/settings/local-settings'
import { openDialog } from '../../dialogs/action-creators'
import { DialogType } from '../../dialogs/dialog-type'
import { FilledButton } from '../../material/button'
import { useAppDispatch } from '../../redux-hooks'
import { bodyMedium, labelMedium, titleMedium } from '../../styles/typography'
import { GameDefaultsPreview, GameDefaultsPreviewKind } from '../game/game-defaults-preview'

const ALL_KINDS: ReadonlyArray<GameDefaultsPreviewKind> = [
  'startingFog',
  'cursor',
  'teamColors',
  'grabPan',
]

const Container = styled.div`
  max-width: 960px;
  padding: 16px;

  display: flex;
  flex-direction: column;
  gap: 24px;
`

const SectionTitle = styled.div`
  ${titleMedium};
`

const PreviewGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 200px);
  gap: 16px;
`

const PreviewEntry = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const PreviewLabel = styled.div`
  ${labelMedium};

  color: var(--theme-on-surface-variant);
`

const Buttons = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

const Note = styled.div`
  ${bodyMedium};

  color: var(--theme-on-surface-variant);
`

export function GameDefaultsTest() {
  const dispatch = useAppDispatch()

  return (
    <Container>
      <div>
        <SectionTitle>Preset previews</SectionTitle>
        <PreviewGrid>
          {[GameDefaultsPreset.Recommended, GameDefaultsPreset.Legacy].map(preset =>
            ALL_KINDS.map(kind => (
              <PreviewEntry key={`${preset}-${kind}`}>
                <PreviewLabel>
                  {kind} / {preset}
                </PreviewLabel>
                <GameDefaultsPreview kind={kind} preset={preset} />
              </PreviewEntry>
            )),
          )}
        </PreviewGrid>
      </div>

      <div>
        <SectionTitle>Dialogs</SectionTitle>
        <Note>
          These write to the real local settings when confirmed, and only do anything in the
          Electron app.
        </Note>
        <Buttons>
          <FilledButton
            label='First run'
            onClick={() => dispatch(openDialog({ type: DialogType.GameDefaultsFirstRun }))}
          />
          <FilledButton
            label='Apply (switched to Legacy)'
            onClick={() =>
              dispatch(
                openDialog({
                  type: DialogType.GameDefaultsApply,
                  initData: { preset: GameDefaultsPreset.Legacy, justSwitched: true },
                }),
              )
            }
          />
          <FilledButton
            label='Apply (reset to Recommended)'
            onClick={() =>
              dispatch(
                openDialog({
                  type: DialogType.GameDefaultsApply,
                  initData: { preset: GameDefaultsPreset.Recommended, justSwitched: false },
                }),
              )
            }
          />
        </Buttons>
      </div>
    </Container>
  )
}
