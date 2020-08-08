import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'

import CheckBox from '../material/check-box.jsx'
import Dialog from '../material/dialog.jsx'
import FlatButton from '../material/flat-button.jsx'
import form from '../forms/form.jsx'
import IconButton from '../material/icon-button.jsx'
import { Label } from '../material/button.jsx'
import Option from '../material/select/option.jsx'
import SubmitOnEnter from '../forms/submit-on-enter.jsx'
import Select from '../material/select/select.jsx'
import Slider from '../material/slider.jsx'

import SetPathIcon from '../icons/material/ic_settings_black_36px.svg'

import { openDialog, closeDialog } from '../dialogs/action-creators'
import { mergeLocalSettings } from './action-creators'
import { isStarcraftRemastered } from '../starcraft/is-starcraft-healthy'

import { colorTextSecondary, colorError } from '../styles/colors'
import { Body1, Subheading } from '../styles/typography'

const screen = IS_ELECTRON ? require('electron').remote.screen : null
const getResolution = () => screen.getPrimaryDisplay().size

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

const TitleActionContainer = styled.div`
  display: flex;
  align-items: center;
  margin-right: 24px;
`

const TitleActionText = styled(Body1)`
  color: ${colorTextSecondary};
  margin-right: 4px;

  &:hover {
    cursor: pointer;
  }
`

const TitleActionButton = styled(IconButton)`
  flex-shrink: 0;
  min-height: 40px;
  width: 40px;
  line-height: 40px;

  & ${Label} {
    color: ${colorTextSecondary};
  }
`

const ErrorText = styled(Subheading)`
  color: ${colorError};
`

@form()
class SettingsRemasteredForm extends React.Component {
  render() {
    const { bindCustom, onSubmit } = this.props

    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <SubmitOnEnter />
        <Select {...bindCustom('displayMode')} label='Display mode' tabIndex={0}>
          <Option value={0} text='Fullscreen' />
          <Option value={1} text='Borderless Window' />
          <Option value={2} text='Windowed' />
        </Select>
      </form>
    )
  }
}

@form()
class Settings1161Form extends React.Component {
  isFullscreen() {
    return this.props.getInputValue('displayMode') === 0
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
        <Select {...bindCustom('displayMode')} label='Display mode' tabIndex={0}>
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
          {...bindCheckable('maintainAspectRatio')}
          label='Maintain aspect ratio'
          disabled={!this.isFullscreen()}
          inputProps={{ tabIndex: 0 }}
        />
        <Slider
          {...bindCustom('sensitivity')}
          label='Mouse sensitivity'
          tabIndex={0}
          min={0}
          max={10}
          step={1}
        />
      </form>
    )
  }
}

@connect(state => ({ settings: state.settings, starcraft: state.starcraft }))
export default class Settings extends React.Component {
  _form = React.createRef()
  _saveButton = React.createRef()
  // NOTE(tec27): Slight optimizaton, since getting the resolution is IPC'd. We assume it will
  // never change while this form is up. I think this is mostly true (and at worst, you just close
  // Settings and re-open it and you're fine)
  _resolution = getResolution()

  componentDidMount() {
    this._saveButton.current.focus()
  }

  getDefaultWindowSizeValue(localSettings) {
    const { width, height } = this._resolution
    const filteredSizes = filterWindowSizes(width, height)
    for (const size of filteredSizes) {
      if (size.width === localSettings.width && size.height === localSettings.height) {
        return { width: size.width, height: size.height }
      }
    }

    // This case can happen when going from fullscreen resolution (which is not in our supported
    // window sizes) to a windowed mode. We return the highest possible window size
    const highest = filteredSizes[filteredSizes.length - 1]
    return { width: highest.width, height: highest.height }
  }

  render() {
    const { onCancel } = this.props
    const { local } = this.props.settings

    const formModel = {
      displayMode: local.displayMode,
      maintainAspectRatio: local.maintainAspectRatio,
      sensitivity: local.mouseSensitivity,
      windowSize: this.getDefaultWindowSizeValue(local),
    }

    const isRemastered = isStarcraftRemastered(this.props)
    const starcraftVersionText = isRemastered ? 'StarCraft: Remastered' : 'StarCraft v1.16.1'
    const titleAction = (
      <TitleActionContainer>
        <TitleActionText onClick={this.onSetPathClick}>{starcraftVersionText}</TitleActionText>
        <TitleActionButton
          icon={<SetPathIcon />}
          title='Change StarCraft path'
          onClick={this.onSetPathClick}
        />
      </TitleActionContainer>
    )
    const buttons = [
      <FlatButton label='Cancel' key='cancel' color='accent' onClick={this.onSettingsCancel} />,
      <FlatButton
        ref={this._saveButton}
        label='Save'
        key='save'
        color='accent'
        onClick={this.onSettingsSave}
      />,
    ]

    const defaultWindowSize = this.getDefaultWindowSizeValue(local)
    return (
      <Dialog title={'Settings'} titleAction={titleAction} buttons={buttons} onCancel={onCancel}>
        {isRemastered ? (
          <SettingsRemasteredForm ref={this._form} model={formModel} onSubmit={this.onSubmit} />
        ) : (
          <Settings1161Form
            ref={this._form}
            resolution={this._resolution}
            defaultWindowSize={defaultWindowSize}
            model={formModel}
            onSubmit={this.onSubmit}
          />
        )}
        {local.lastError ? (
          <ErrorText>There was an issue saving the settings. Please try again.</ErrorText>
        ) : null}
      </Dialog>
    )
  }

  onSetPathClick = () => {
    this.props.dispatch(openDialog('starcraftPath'))
  }

  onSettingsSave = () => {
    this._form.current.submit()
  }

  onSettingsCancel = () => {
    this.props.dispatch(closeDialog())
  }

  onSubmit = () => {
    const values = this._form.current.getModel()
    const windowSize = values.windowSize || {}
    const newSettings = {
      width: windowSize.width,
      height: windowSize.height,
      displayMode: values.displayMode,
      mouseSensitivity: values.sensitivity,
      maintainAspectRatio: values.maintainAspectRatio,
    }
    this.props.dispatch(mergeLocalSettings(newSettings))

    if (!this.props.settings.local.lastError) {
      this.props.dispatch(closeDialog())
    }
  }
}
