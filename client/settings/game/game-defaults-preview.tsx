import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { GameDefaultsPreset, TeamColorPreset } from '../../../common/settings/local-settings'
import { TEAM_COLOR_PRESETS } from '../../../common/settings/team-colors'
import { labelSmall } from '../../styles/typography'

/*
  Each kind is an isolated scene rendered inside a shared 5:3 frame. Starting fog and cursor size
  are in-game captures (364x216, twice the frame's on-screen size so they stay sharp on scaled
  displays). Team colors is still a schematic drawn in CSS until a capture replaces it. The drag
  pan scene (a sensitivity slider) is deliberately schematic and is the intended final form for
  that kind.
*/

/** Which setting a {@link GameDefaultsPreview} illustrates. */
export type GameDefaultsPreviewKind = 'startingFog' | 'cursor' | 'teamColors' | 'grabPan'

const PreviewRoot = styled.div`
  position: relative;
  width: 100%;
  max-width: 100%;
  aspect-ratio: 5 / 3;

  background-color: #07090f;
  border: 1px solid var(--theme-outline-variant);
  border-radius: 4px;
  box-sizing: border-box;
  overflow: hidden;
`

export function GameDefaultsPreview({
  kind,
  preset,
  className,
}: {
  kind: GameDefaultsPreviewKind
  preset: GameDefaultsPreset
  className?: string
}) {
  let scene: React.ReactNode
  switch (kind) {
    case 'startingFog':
      scene = <CapturedScene file='starting-fog' preset={preset} />
      break
    case 'cursor':
      scene = <CapturedScene file='cursor' preset={preset} />
      break
    case 'teamColors':
      scene = <TeamColorsScene preset={preset} />
      break
    case 'grabPan':
      scene = <GrabPanScene preset={preset} />
      break
    default:
      scene = assertUnreachable(kind)
  }

  return <PreviewRoot className={className}>{scene}</PreviewRoot>
}

const SceneImage = styled.img`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;

  display: block;
  object-fit: cover;
`

/**
 * An in-game capture of the setting under each preset. The files are named by the kind's stem and
 * the preset's string value, e.g. `starting-fog-legacy.webp`. They ship as Electron assets
 * (`app/assets/game-defaults`) rather than server-hosted public assets: these previews only ever
 * render inside the Electron app, and loading them straight off disk through the `shieldbattery://`
 * protocol (see `app/app.ts`'s asset protocol handler) keeps the first-run dialog whole without a
 * network connection. The web build's dev page can't resolve that scheme, so the frames stay
 * empty there.
 */
function CapturedScene({
  file,
  preset,
}: {
  file: 'starting-fog' | 'cursor'
  preset: GameDefaultsPreset
}) {
  return (
    <SceneImage
      src={`shieldbattery://app/assets/game-defaults/${file}-${preset}.webp`}
      alt=''
      draggable={false}
    />
  )
}

const TeamColorsBackdrop = styled.div`
  position: absolute;
  inset: 0;

  background:
    radial-gradient(ellipse 60% 70% at 20% 80%, #1a2438 0 60%, transparent 61%),
    radial-gradient(ellipse 50% 60% at 82% 22%, #1a2438 0 60%, transparent 61%), #0d1220;
`

const SelfAndAllies = styled.div`
  position: absolute;
  left: 12%;
  bottom: 18%;

  display: flex;
  align-items: flex-end;
  gap: 6px;
`

const Enemies = styled.div`
  position: absolute;
  right: 12%;
  top: 18%;

  display: flex;
  align-items: flex-start;
  gap: 6px;
`

const UnitCluster = styled.div<{ $columns: number }>`
  display: grid;
  grid-template-columns: repeat(${props => props.$columns}, 4px);
  gap: 1px;
`

const UnitSquare = styled.i<{ $color: string }>`
  display: block;
  width: 4px;
  height: 4px;

  background-color: ${props => props.$color};
`

function UnitClusterView({
  color,
  count,
  columns,
}: {
  color: string
  count: number
  columns: number
}) {
  return (
    <UnitCluster $columns={columns}>
      {Array.from({ length: count }, (_, i) => (
        <UnitSquare key={i} $color={color} />
      ))}
    </UnitCluster>
  )
}

/**
 * The colors a game would draw the local player, 2 allies and 2 enemies in. Color pools wrap when
 * a game needs more colors than they hold, so a pool shorter than this scene repeats from its
 * start the same way a game would use it.
 */
function TeamColorsScene({ preset }: { preset: GameDefaultsPreset }) {
  const colors =
    TEAM_COLOR_PRESETS[
      preset === GameDefaultsPreset.Recommended
        ? TeamColorPreset.CoolVsWarm
        : TeamColorPreset.LegacyDiplomacy
    ]

  return (
    <>
      <TeamColorsBackdrop />
      <SelfAndAllies>
        <UnitClusterView color={colors.self} count={5} columns={3} />
        <UnitClusterView color={colors.allies[0]} count={3} columns={2} />
        <UnitClusterView color={colors.allies[1 % colors.allies.length]} count={4} columns={2} />
      </SelfAndAllies>
      <Enemies>
        <UnitClusterView color={colors.enemies[0]} count={6} columns={3} />
        <UnitClusterView color={colors.enemies[1 % colors.enemies.length]} count={3} columns={2} />
      </Enemies>
    </>
  )
}

const GrabPanSceneRoot = styled.div`
  position: absolute;
  inset: 0;
  padding: 0 18px;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;

  background: radial-gradient(ellipse at 50% 120%, #182031, transparent 70%);
`

const SliderTrack = styled.div`
  position: relative;
  width: 100%;
  height: 4px;

  background-color: #2e3e5b;
  border-radius: 2px;
`

const SliderFill = styled.div<{ $color: string; $position: string }>`
  position: absolute;
  left: 0;
  top: 0;
  width: ${props => props.$position};
  height: 4px;

  background-color: ${props => props.$color};
  border-radius: 2px;
`

const SliderKnob = styled.div<{ $color: string; $position: string }>`
  position: absolute;
  top: 50%;
  left: ${props => props.$position};
  width: 14px;
  height: 14px;
  margin: -7px 0 0 -7px;

  background-color: ${props => props.$color};
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.6);
`

const SliderCaption = styled.div<{ $color: string }>`
  ${labelSmall};
  font-size: 10px;
  line-height: 12px;

  color: ${props => props.$color};
  text-transform: uppercase;
`

/** A sensitivity slider Recommended lets the player move and Legacy pins to the game's own speed. */
function GrabPanScene({ preset }: { preset: GameDefaultsPreset }) {
  const { t } = useTranslation()
  const recommended = preset === GameDefaultsPreset.Recommended

  const position = recommended ? '62%' : '38%'
  const fillColor = recommended ? 'var(--theme-amber)' : '#62789e'
  const knobColor = recommended ? 'var(--theme-amber)' : '#9bb1d3'
  const captionColor = recommended ? 'var(--color-amber80)' : 'var(--color-grey-blue80)'
  const caption = recommended
    ? t('settings.game.defaults.preview.grabPanAdjustable', 'Adjustable')
    : t('settings.game.defaults.preview.grabPanFixed', 'Fixed speed')

  return (
    <GrabPanSceneRoot>
      <SliderTrack>
        <SliderFill $color={fillColor} $position={position} />
        <SliderKnob $color={knobColor} $position={position} />
      </SliderTrack>
      <SliderCaption $color={captionColor}>{caption}</SliderCaption>
    </GrabPanSceneRoot>
  )
}
