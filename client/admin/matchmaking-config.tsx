import { useState } from 'react'
import styled from 'styled-components'
import { useMutation, useQuery } from 'urql'
import { ALL_MATCHMAKING_TYPES, MatchmakingType } from '../../common/matchmaking'
import { useSelfPermissions } from '../auth/auth-utils'
import { graphql } from '../gql'
import {
  AdminMatchmakingConfigQuery as AdminMatchmakingConfigQueryType,
  MatchmakerConfigInput,
  MatchmakerModeConfigOverridesInput,
} from '../gql/graphql'
import { logger } from '../logging/logger'
import { FilledButton, TextButton } from '../material/button'
import { TextField } from '../material/text-field'
import { LoadingDotsArea } from '../progress/dots'
import { bodyLarge, titleLarge, titleMedium } from '../styles/typography'

const Container = styled.div`
  height: 100%;
  max-width: 860px;
  padding: 0 16px 48px;

  overflow-x: hidden;
  overflow-y: auto;
`

const PageHeadline = styled.div`
  ${titleLarge};
  margin-top: 16px;
  margin-bottom: 8px;
`

const SectionTitle = styled.div`
  ${titleMedium};
  margin-top: 24px;
  margin-bottom: 8px;
`

const HelpText = styled.div`
  ${bodyLarge};
  color: var(--theme-on-surface-variant);
  margin-bottom: 16px;
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
  margin: 8px 0;
`

const SuccessText = styled.div`
  ${bodyLarge};
  color: var(--theme-amber);
  margin: 8px 0;
`

const FieldGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 8px 24px;
`

const PerModeSection = styled.details`
  margin: 8px 0;
  padding: 8px 12px;
  border: 1px solid var(--theme-outline-variant);
  border-radius: 4px;

  & > summary {
    ${titleMedium};
    cursor: pointer;
  }
`

const Actions = styled.div`
  display: flex;
  gap: 16px;
  margin-top: 24px;
`

/** A tunable mode knob: the GraphQL field name plus how to label, hint, and parse it. */
interface KnobField {
  key: string
  label: string
  hint: string
  /** GraphQL Int field — must be sent as an integer. */
  int?: boolean
}

const MODE_KNOBS: KnobField[] = [
  { key: 'minQuality', label: 'Min quality', hint: 'Base threshold, seconds of wait (−600…60)' },
  {
    key: 'weightWinProb',
    label: 'Win-prob imbalance weight',
    hint: 'Seconds traded per unit of win-prob imbalance (0…500)',
  },
  {
    key: 'weightRatingVariance',
    label: 'Skill variance weight',
    hint: 'Seconds traded per unit of rating variance (0…0.1)',
  },
  {
    key: 'weightLatency',
    label: 'Latency weight',
    hint: 'Seconds traded per turn-rate step (0…300)',
  },
  { key: 'uncertaintyK', label: 'Uncertainty K', hint: 'σ multiplier for effective rating (0…3)' },
  {
    key: 'adaptiveComfortableMultiplier',
    label: 'Comfortable multiplier',
    hint: '× mode size = comfortable population (1…10)',
    int: true,
  },
  {
    key: 'adaptiveDecayPerMissing',
    label: 'Decay per missing player',
    hint: 'Seconds the threshold drops per missing player (0…120)',
  },
  {
    key: 'populationHalfLifeSeconds',
    label: 'Population half-life (s)',
    hint: 'EWMA half-life of the population estimate (60…86400)',
  },
]

const OPERATIONAL_KNOBS: KnobField[] = [
  {
    key: 'searchIntervalSeconds',
    label: 'Search interval (s)',
    hint: 'How often the matcher runs, in seconds (1…60)',
  },
  {
    key: 'maxPlayersExamined',
    label: 'Max players examined',
    hint: 'Queue entries examined per mode per tick (2…200)',
    int: true,
  },
]

const MatchmakingConfigQuery = graphql(/* GraphQL */ `
  query AdminMatchmakingConfig {
    matchmakingConfig {
      searchIntervalSeconds
      maxPlayersExamined
      global {
        weightRatingVariance
        weightWinProb
        weightLatency
        uncertaintyK
        minQuality
        adaptiveComfortableMultiplier
        adaptiveDecayPerMissing
        populationHalfLifeSeconds
      }
      perMode {
        matchmakingType
        config {
          weightRatingVariance
          weightWinProb
          weightLatency
          uncertaintyK
          minQuality
          adaptiveComfortableMultiplier
          adaptiveDecayPerMissing
          populationHalfLifeSeconds
        }
      }
      defaults {
        searchIntervalSeconds
        maxPlayersExamined
        weightRatingVariance
        weightWinProb
        weightLatency
        uncertaintyK
        minQuality
        adaptiveComfortableMultiplier
        adaptiveDecayPerMissing
        populationHalfLifeSeconds
      }
    }
  }
`)

const UpdateMatchmakingConfigMutation = graphql(/* GraphQL */ `
  mutation AdminUpdateMatchmakingConfig($config: MatchmakerConfigInput!) {
    updateMatchmakingConfig(config: $config) {
      searchIntervalSeconds
      maxPlayersExamined
      global {
        minQuality
      }
    }
  }
`)

type ConfigData = NonNullable<AdminMatchmakingConfigQueryType['matchmakingConfig']>

/** Input strings keyed by knob field name. An empty string means "no override" for that field. */
type KnobInputs = Record<string, string>

/**
 * Formats a knob number for display, trimming f32 float noise. Every knob is an `f32` server-side,
 * so a value like `0.005` round-trips through JSON as `0.004999999888241291`; trimming to 6
 * significant digits restores the intended number. 6 digits is lossless for every knob's range, and
 * since the form re-parses with `Number()` a trimmed value round-trips back to the same stored f32.
 */
function formatNumber(value: number): string {
  return String(Number(value.toPrecision(6)))
}

function numToStr(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : formatNumber(value)
}

/** Maps an overrides object from the API (numbers/nulls) to the form's string inputs. */
function toInputs(
  overrides: Record<string, number | null | undefined> | null | undefined,
): KnobInputs {
  const result: KnobInputs = {}
  for (const { key } of MODE_KNOBS) {
    result[key] = numToStr(overrides?.[key])
  }
  return result
}

/** Parses the form's string inputs back into a sparse overrides object (empty string → null). */
function fromInputs(inputs: KnobInputs): MatchmakerModeConfigOverridesInput {
  const num = (key: string, int?: boolean): number | null => {
    const raw = inputs[key]?.trim() ?? ''
    if (raw === '') {
      return null
    }
    return int ? Math.round(Number(raw)) : Number(raw)
  }
  return {
    weightRatingVariance: num('weightRatingVariance'),
    weightWinProb: num('weightWinProb'),
    weightLatency: num('weightLatency'),
    uncertaintyK: num('uncertaintyK'),
    minQuality: num('minQuality'),
    adaptiveComfortableMultiplier: num('adaptiveComfortableMultiplier', true),
    adaptiveDecayPerMissing: num('adaptiveDecayPerMissing'),
    populationHalfLifeSeconds: num('populationHalfLifeSeconds'),
  }
}

function overrideCount(inputs: KnobInputs): number {
  return MODE_KNOBS.filter(({ key }) => (inputs[key]?.trim() ?? '') !== '').length
}

function KnobInput({
  field,
  value,
  placeholder,
  onChange,
  disabled,
}: {
  field: KnobField
  value: string
  placeholder: number | undefined
  onChange: (value: string) => void
  disabled: boolean
}) {
  // Fold the default into the floating label rather than using a native placeholder: a floating
  // label rests in the same spot the placeholder occupies, so showing both overlaps them. As the
  // label, the default stays visible at rest and once a value is entered the label floats up,
  // keeping the default alongside the override.
  const label =
    placeholder === undefined
      ? field.label
      : `${field.label} (default ${formatNumber(placeholder)})`
  return (
    <TextField
      label={label}
      floatingLabel={true}
      dense={true}
      type='number'
      value={value}
      allowErrors={false}
      onChange={event => onChange(event.target.value)}
      disabled={disabled}
      inputProps={{
        tabIndex: 0,
        step: field.int ? 1 : 'any',
        'aria-label': field.label,
        title: field.hint,
      }}
    />
  )
}

export function AdminMatchmakingConfig() {
  const perms = useSelfPermissions()
  const [{ data, error }, refetch] = useQuery({
    query: MatchmakingConfigQuery,
    pause: !perms?.manageMatchmaking,
  })
  const [{ fetching: saving }, updateConfig] = useMutation(UpdateMatchmakingConfigMutation)

  // Bumped on Reset; used as the form's `key` so it remounts and re-seeds from the latest data.
  const [formVersion, setFormVersion] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string>()
  const [saved, setSaved] = useState(false)

  if (!perms?.manageMatchmaking) {
    return (
      <Container>
        <ErrorText>Access denied.</ErrorText>
      </Container>
    )
  }
  if (error) {
    return (
      <Container>
        <ErrorText>{error.message}</ErrorText>
      </Container>
    )
  }
  if (!data?.matchmakingConfig) {
    return <LoadingDotsArea />
  }

  const onSave = (input: MatchmakerConfigInput) => {
    setErrorMessage(undefined)
    updateConfig({ config: input })
      .then(result => {
        if (result.error) {
          setErrorMessage(result.error.message)
          setSaved(false)
        } else {
          // Don't remount the form here: the stored config isn't normalized on write, so the form
          // already shows exactly what was saved. Remounting would re-seed from `data`, which is
          // still the pre-save value until the async `refetch` lands — visibly reverting the just-
          // saved fields. The refetch keeps `data` current so a later Reset baselines correctly.
          setSaved(true)
          refetch({ requestPolicy: 'network-only' })
        }
      })
      .catch(err => logger.error(`Error updating matchmaking config: ${err.stack ?? err}`))
  }

  return (
    <Container>
      <PageHeadline>Matchmaking config</PageHeadline>
      <HelpText>
        Tunes the live matchmaker. Leave a field blank to use its default (shown as a placeholder).
        The live matchmaker clamps each value to a safe range, and changes take effect on the next
        search tick — no restart needed.
      </HelpText>

      {errorMessage ? <ErrorText>{errorMessage}</ErrorText> : null}
      {saved ? <SuccessText>Saved. The live matchmaker has been updated.</SuccessText> : null}

      <ConfigForm
        key={formVersion}
        config={data.matchmakingConfig}
        saving={saving}
        onSave={onSave}
        onEdit={() => setSaved(false)}
        onReset={() => {
          setErrorMessage(undefined)
          setSaved(false)
          setFormVersion(v => v + 1)
        }}
      />
    </Container>
  )
}

function ConfigForm({
  config,
  saving,
  onSave,
  onEdit,
  onReset,
}: {
  config: ConfigData
  saving: boolean
  onSave: (input: MatchmakerConfigInput) => void
  onEdit: () => void
  onReset: () => void
}) {
  const defaults = config.defaults as unknown as Record<string, number>

  const [operational, setOperational] = useState<KnobInputs>(() => ({
    searchIntervalSeconds: numToStr(config.searchIntervalSeconds),
    maxPlayersExamined: numToStr(config.maxPlayersExamined),
  }))
  const [global, setGlobal] = useState<KnobInputs>(() => toInputs(config.global))
  const [perMode, setPerMode] = useState<Map<MatchmakingType, KnobInputs>>(() => {
    const map = new Map<MatchmakingType, KnobInputs>()
    for (const type of ALL_MATCHMAKING_TYPES) {
      const entry = config.perMode.find(p => p.matchmakingType === type)
      map.set(type, toInputs(entry?.config))
    }
    return map
  })

  // Editing any field invalidates the "Saved" banner, so it can't keep claiming the live matchmaker
  // matches what's on screen once there are unsaved changes.
  const setOperationalField = (key: string, value: string) => {
    onEdit()
    setOperational(prev => ({ ...prev, [key]: value }))
  }
  const setGlobalField = (key: string, value: string) => {
    onEdit()
    setGlobal(prev => ({ ...prev, [key]: value }))
  }
  const setPerModeField = (type: MatchmakingType, key: string, value: string) => {
    onEdit()
    setPerMode(prev => {
      const next = new Map(prev)
      next.set(type, { ...(next.get(type) ?? {}), [key]: value })
      return next
    })
  }

  const handleSave = () => {
    const search = operational.searchIntervalSeconds.trim()
    const max = operational.maxPlayersExamined.trim()
    onSave({
      searchIntervalSeconds: search === '' ? null : Number(search),
      maxPlayersExamined: max === '' ? null : Math.round(Number(max)),
      global: fromInputs(global),
      perMode: [...perMode.entries()]
        .filter(([, values]) => overrideCount(values) > 0)
        .map(([matchmakingType, values]) => ({ matchmakingType, config: fromInputs(values) })),
    })
  }

  return (
    <>
      <SectionTitle>Operational</SectionTitle>
      <FieldGrid>
        {OPERATIONAL_KNOBS.map(field => (
          <KnobInput
            key={field.key}
            field={field}
            value={operational[field.key] ?? ''}
            placeholder={defaults[field.key]}
            onChange={value => setOperationalField(field.key, value)}
            disabled={saving}
          />
        ))}
      </FieldGrid>

      <SectionTitle>Global formula &amp; threshold</SectionTitle>
      <FieldGrid>
        {MODE_KNOBS.map(field => (
          <KnobInput
            key={field.key}
            field={field}
            value={global[field.key] ?? ''}
            placeholder={defaults[field.key]}
            onChange={value => setGlobalField(field.key, value)}
            disabled={saving}
          />
        ))}
      </FieldGrid>

      <SectionTitle>Per-mode overrides</SectionTitle>
      <HelpText>
        Blank fields inherit the global value above. A mode is only overridden for the fields you
        fill in.
      </HelpText>
      {ALL_MATCHMAKING_TYPES.map(type => {
        const values = perMode.get(type) ?? {}
        const count = overrideCount(values)
        return (
          <PerModeSection key={type}>
            <summary>
              {type}
              {count > 0 ? ` — ${count} override(s)` : ''}
            </summary>
            <FieldGrid>
              {MODE_KNOBS.map(field => {
                const globalValue = global[field.key]?.trim() ?? ''
                const inherited = globalValue !== '' ? Number(globalValue) : defaults[field.key]
                return (
                  <KnobInput
                    key={field.key}
                    field={field}
                    value={values[field.key] ?? ''}
                    placeholder={inherited}
                    onChange={value => setPerModeField(type, field.key, value)}
                    disabled={saving}
                  />
                )
              })}
            </FieldGrid>
          </PerModeSection>
        )
      })}

      <Actions>
        <FilledButton label='Save' onClick={handleSave} disabled={saving} />
        <TextButton label='Reset' onClick={onReset} disabled={saving} />
      </Actions>
    </>
  )
}
