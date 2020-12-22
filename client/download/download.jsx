import React from 'react'
import styled from 'styled-components'

import { colorText } from '../styles/colors.ts'
import { Body2 } from '../styles/typography.ts'

import RaisedButton from '../material/raised-button.jsx'
import GetApp from '../icons/material/ic_get_app_black_36px.svg'

const Blurb = styled(Body2)`
  margin-bottom: 24px;
  text-align: center;
`

const InstallerLinks = styled.div`
  max-width: 420px;
  margin: 0px auto;
  display: flex;
  flex-direction: column;
`

const InstallerButtonIcon = styled(GetApp)`
  width: 24px;
  height: 24px;
  margin-right: 8px;
  color: ${colorText};
`

const InstallerButtonLabel = styled.span`
  display: flex;
  align-items: center;
`

export default class Download extends React.Component {
  render() {
    return (
      <React.Fragment>
        <Blurb as='p'>
          Download the ShieldBattery standalone client to play games, watch replays, and more!
        </Blurb>
        <InstallerLinks>
          <RaisedButton
            onClick={this.onDownloadClick}
            label={
              <InstallerButtonLabel>
                <InstallerButtonIcon />
                <span>Download client</span>
              </InstallerButtonLabel>
            }
          />
        </InstallerLinks>
      </React.Fragment>
    )
  }

  onDownloadClick = () => {
    window.location.assign('/published_artifacts/win/ShieldBattery.latest.exe')
  }
}
