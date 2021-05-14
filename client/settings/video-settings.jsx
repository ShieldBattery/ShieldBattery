import PropTypes from 'prop-types'
import React from 'react'
import { ALL_DISPLAY_MODES, getDisplayModeName } from '../../common/blizz-settings'
import form from '../forms/form'
import SubmitOnEnter from '../forms/submit-on-enter'
import CheckBox from '../material/check-box'
import { Option } from '../material/select/option'
import { Select } from '../material/select/select'
import Slider from '../material/slider'
import { FormContainer } from './settings-content'

const SUPPORTED_WINDOW_SIZES = [
  { width: 640, height: 480 },
  { width: 800, height: 600 },
  { width: 1024, height: 768 },
  { width: 1152, height: 864 },
  { width: 1280, height: 960 },
  { width: 1400, height: 1050 },
  { width: 1600, height: 1200 },
  { width: 2048, height: 1536 },
  { width: 3200, height: 2400 },
  { width: 4000, height: 3000 },
  { width: 6400, height: 4800 },
]

function filterWindowSizes(width, height) {
  return SUPPORTED_WINDOW_SIZES.filter(r => r.width <= width && r.height <= height)
}

const compareResolutions = (a, b) => a.width === b.width && a.height === b.height

// NOTE(tec27): Vsync is weird and is a number in the settings, but actually a boolean value. This
// component just acts as a custom one and does the conversion
function VsyncCheckBox(props) {
  return (
    <CheckBox
      name={props.name}
      checked={!!props.value}
      errorText={props.errorText}
      label={props.label}
      inputProps={props.inputProps}
      onChange={event => {
        const { name, checked } = event.target
        props.onChange(name, checked ? 1 : 0)
      }}
    />
  )
}

@form()
class VideoRemasteredForm extends React.Component {
  render() {
    const { bindCheckable, bindCustom, onSubmit } = this.props

    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <SubmitOnEnter />
        <FormContainer>
          <div>
            <Select {...bindCustom('displayMode')} label='Display mode' tabIndex={0}>
              {ALL_DISPLAY_MODES.map((dm, i) => (
                <Option key={i} value={dm} text={getDisplayModeName(dm)} />
              ))}
            </Select>
            <Slider
              {...bindCustom('sdGraphicsFilter')}
              label='SD graphics filter'
              tabIndex={0}
              min={0}
              max={3}
              step={1}
            />
            <CheckBox
              {...bindCheckable('fpsLimitOn')}
              label='Enable FPS limit'
              inputProps={{ tabIndex: 0 }}
            />
            <Slider
              {...bindCustom('fpsLimit')}
              label='FPS limit'
              tabIndex={0}
              min={100}
              max={300}
              step={1}
              disabled={!this.props.getInputValue('fpsLimitOn')}
              showTicks={false}
            />
          </div>
          <div>
            <VsyncCheckBox
              {...bindCustom('vsyncOn')}
              label='Enable vertical sync'
              inputProps={{ tabIndex: 0 }}
            />
            <CheckBox
              {...bindCheckable('hdGraphicsOn')}
              label='HD graphics'
              inputProps={{ tabIndex: 0 }}
            />
            <CheckBox
              {...bindCheckable('environmentEffectsOn')}
              label='Environment effects'
              inputProps={{ tabIndex: 0 }}
            />
            <CheckBox
              {...bindCheckable('realTimeLightingOn')}
              label='Real-time lighting'
              inputProps={{ tabIndex: 0 }}
            />
            <CheckBox
              {...bindCheckable('smoothUnitTurningOn')}
              label='Smooth unit turning'
              inputProps={{ tabIndex: 0 }}
            />
            <CheckBox
              {...bindCheckable('shadowStackingOn')}
              label='Shadow stacking'
              inputProps={{ tabIndex: 0 }}
            />
            <CheckBox
              {...bindCheckable('pillarboxOn')}
              label='Keep aspect ratio'
              inputProps={{ tabIndex: 0 }}
            />
          </div>
        </FormContainer>
      </form>
    )
  }
}

@form()
class Video1161Form extends React.Component {
  isFullscreen() {
    return this.props.getInputValue('v1161displayMode') === 0
  }

  renderWindowSizeOptions(resolution) {
    const { width, height } = resolution
    if (this.isFullscreen()) {
      return <Option value={{ width, height }} text={`${width}x${height}`} />
    }

    return filterWindowSizes(width, height).map((size, i) => {
      return (
        <Option
          key={i}
          value={{ width: size.width, height: size.height }}
          text={`${size.width}x${size.height}`}
        />
      )
    })
  }

  render() {
    const { bindCheckable, bindCustom, onSubmit, resolution } = this.props

    const windowSizeProps = this.isFullscreen()
      ? {
          value: { width: resolution.width, height: resolution.height },
          disabled: true,
        }
      : {
          ...bindCustom('windowSize'),
        }

    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <SubmitOnEnter />
        <Select {...bindCustom('v1161displayMode')} label='Display mode' tabIndex={0}>
          <Option value={0} text='Fullscreen' />
          <Option value={1} text='Borderless Window' />
          <Option value={2} text='Windowed' />
        </Select>
        <Select
          {...windowSizeProps}
          label='Window size'
          tabIndex={0}
          compareValues={compareResolutions}>
          {this.renderWindowSizeOptions(resolution)}
        </Select>
        <CheckBox
          {...bindCheckable('v1161maintainAspectRatio')}
          label='Maintain aspect ratio'
          disabled={!this.isFullscreen()}
          inputProps={{ tabIndex: 0 }}
        />
      </form>
    )
  }
}

export default class VideoSettings extends React.Component {
  static propTypes = {
    localSettings: PropTypes.object.isRequired,
    resolution: PropTypes.object.isRequired,
    formRef: PropTypes.object.isRequired,
    isRemastered: PropTypes.bool,
    onChange: PropTypes.func.isRequired,
    onSubmit: PropTypes.func.isRequired,
  }

  getDefaultWindowSizeValue(localSettings) {
    const { width, height } = this.props.resolution
    const filteredSizes = filterWindowSizes(width, height)
    for (const size of filteredSizes) {
      if (
        size.width === localSettings.gameWinWidth &&
        size.height === localSettings.gameWinHeight
      ) {
        return { width: size.width, height: size.height }
      }
    }

    // This case can happen when going from fullscreen resolution (which is not in our supported
    // window sizes) to a windowed mode. We return the highest possible window size
    const highest = filteredSizes[filteredSizes.length - 1]
    return { width: highest.width, height: highest.height }
  }

  render() {
    const { localSettings, scrSettings, resolution, formRef, isRemastered } = this.props

    const form1161Model = {
      v1161displayMode: localSettings.v1161displayMode,
      v1161maintainAspectRatio: localSettings.v1161maintainAspectRatio,
      windowSize: this.getDefaultWindowSizeValue(localSettings),
    }
    const formScrModel = { ...scrSettings.toJS() }

    const defaultWindowSize = this.getDefaultWindowSizeValue(localSettings)
    return isRemastered ? (
      <VideoRemasteredForm
        ref={formRef}
        model={formScrModel}
        onChange={this.onChange}
        onSubmit={this.onSubmit}
      />
    ) : (
      <Video1161Form
        ref={formRef}
        resolution={resolution}
        defaultWindowSize={defaultWindowSize}
        model={form1161Model}
        onChange={this.onChange}
        onSubmit={this.onSubmit}
      />
    )
  }

  onChange = () => {
    const values = this.props.formRef.current.getModel()
    const windowSize = values.windowSize || {}
    this.props.onChange({
      ...values,
      gameWinWidth: windowSize.width,
      gameWinHeight: windowSize.height,
    })
  }

  onSubmit = () => {
    this.props.onSubmit()
  }
}
