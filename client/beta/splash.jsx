import React from 'react'
import { connect } from 'react-redux'
import { makeServerUrl } from '../network/server-url'
import { push } from 'connected-react-router'
import styled from 'styled-components'

import Card from '../material/card.jsx'
import ConnectedDialogOverlay from '../dialogs/connected-dialog-overlay.jsx'
import RaisedButton from '../material/raised-button.jsx'
import TopLinks from './top-links.jsx'
import { ScrollableContent } from '../material/scroll-bar.jsx'

import ChatImage from './chat.svg'
import LogoText from '../logos/logotext-640x100.svg'

import { openDialog } from '../dialogs/action-creators'
import { grey850, grey900, colorTextSecondary } from '../styles/colors'

const SplashContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  height: auto !important;
  background-color: ${grey900};
  margin: 0px auto;
  overflow: auto;
`

const BackgroundVideo = styled.video`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  width: 100%;
  height: 860px;
  object-fit: fill;
  filter: blur(8px);
  opacity: 0.5;
`

const LogoLockup = styled.div`
  display: flex;
  align-items: center;
  position: relative;
  margin: 20px 0px;
  pointer-events: none;
`

const Logo = styled.img`
  margin-right: 16px;
`

const StyledLogoText = styled(LogoText)`
  width: 320px;
  height: 50px;
`

// TODO(2Pac): Use proper typography css for this from some common place
const TagLine = styled.div`
  position: relative;
  font-family: Roboto Condensed, sans-serif;
  font-size: 34px;
  font-weight: 700;
  line-height: 40px;
  margin: 16px 0px;
`

const ButtonsContainer = styled.div`
  display: flex;
  justify-content: space-between;
  width: 464px;
  margin: 16px 0px;
`

const SplashButton = styled(RaisedButton)`
  width: 200px;
  height: 54px;
  margin: 0px;

  & > span {
    font-size: 18px;
    font-weight: 400;
  }
`

const Feature = styled(Card)`
  width: 368px;
  padding: 12px 24px 24px 24px;
`

const FeatureContainer = styled.div`
  display: flex;
  flex-direction: row;
  margin: 24px 0px 40px 0px;

  & > ${Feature} + ${Feature} {
    margin-left: 16px;
  }
`

const StyledChatImage = styled(ChatImage)`
  width: 100%;
  height: auto;
`

// TODO(2Pac): Use proper typography css for this from some common place
const FeatureTitle = styled.h3`
  font-family: Roboto Condensed, sans-serif;
  font-size: 28px;
  font-weight: 700;
  line-height: 34px;
`

const FeatureBody = styled.div`
  & > p {
    font-size: 16px;
    font-weight: 300;
    line-height: 24px;
  }

  & > p + p {
    margin-top: 32px;
  }
`

const FeatureSection = ({ title, body, image }) => {
  return (
    <Feature>
      {image}
      <FeatureTitle>{title}</FeatureTitle>
      <FeatureBody>{body}</FeatureBody>
    </Feature>
  )
}

const BottomContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  padding-top: 40px;
  background-color: ${grey850};
`

const BottomSection = styled.div`
  width: 864px;
  margin-bottom: 64px;
`

// TODO(2Pac): Use proper typography css for this from some common place
const bottomSectionTitle = `
  font-family: Roboto Condensed, sans-serif;
  font-size: 34px;
  font-weight: 700;
  line-height: 40px;
  margin: 0px;
`

const BottomSectionTitle = styled.h3`
  ${bottomSectionTitle};
`

const BottomSectionList = styled.ul`
  list-style: inside;
  padding-left: 0px;
  column-count: ${props => props.columnCount || 'auto'};
  column-gap: ${props => props.columnGap || 'normal'};

  & > li {
    font-size: 20px;
    font-weight: 300;
    line-height: 40px;
  }
`

const ComingSoonText = styled.span`
  ${bottomSectionTitle};
  color: ${colorTextSecondary};
`

@connect()
export default class Splash extends React.Component {
  features = [
    {
      title: 'A social experience',
      body: [
        <p key='p1'>
          Chat channels? You wanted those, right? No tiny message windows in the corner of the
          screen here; ShieldBattery makes chat a priority and keeps it front and center.
        </p>,
        <p key='p2'>
          You can join tons of channels simultaneously, talk with all your friends and enemies, and
          easily keep tabs on potential rivals. When you’ve figured out the map pool for your
          best-of-21 grudge match, getting into a game is just a few clicks away!
        </p>,
        <p key='p3'>
          We keep all of the chat history for you too, even when you’re not connected, so you can
          keep up with what happened when you (finally) went to sleep last night.
        </p>,
      ],
      image: <StyledChatImage />,
    },
    {
      title: 'Fanatically faithful',
      body: [
        <p key='p1'>
          ShieldBattery is developed and directed by long-time members of the Brood War community,
          and we’ve maintained an intense devotion to keeping the gameplay faithfully intact as
          we’ve solved bugs and added features. From the graphics and sounds down to things like
          mouse movement and latency, we’ve kept things as accurate as possible to what StarCraft
          has always been.
        </p>,
        <p key='p2'>
          The Brood War community has a long history of building its own solutions to problems.
          ShieldBattery descends from this grand lineage, building a modern, seamless experience
          based on a keen understanding of the community’s issues and desires.
        </p>,
      ],
      image: <StyledChatImage />,
    },
    {
      title: 'Seamless and easy',
      body: [
        <p key='p1'>
          Third-party servers and ladders for StarCraft have often required following a complex set
          of instructions, downloading launchers and plugins from shady websites, and fiddling with
          settings for hours until things work.
        </p>,
        <p key='p2'>
          ShieldBattery is different. Download our super fast installer, sign up for an account, and
          be playing in seconds!
        </p>,
        <p key='p3'>
          ShieldBattery supports all modern versions of Brood War and modern operating systems. It
          also packs in an improved network stack so that hosting and network problems are a thing
          of the past.
        </p>,
      ],
      image: <StyledChatImage />,
    },
  ]

  render() {
    return (
      <ScrollableContent>
        <SplashContainer>
          <BackgroundVideo playsInline={true} autoPlay={true} muted={true} loop={true}>
            <source src={makeServerUrl('/videos/splash-video.mp4')} type='video/webm' />
          </BackgroundVideo>
          <TopLinks />
          <LogoLockup>
            <Logo src={makeServerUrl('/images/shieldbattery-128.png')} />
            <StyledLogoText />
          </LogoLockup>
          <TagLine>Play StarCraft: Brood War on the premier community-run platform</TagLine>
          {!IS_ELECTRON ? (
            <ButtonsContainer>
              <SplashButton label='Sign Up' color='primary' onClick={this.onSignUpClick} />
              <SplashButton label='Download' color='primary' onClick={this.onDownloadClick} />
            </ButtonsContainer>
          ) : (
            <SplashButton label='Sign Up' color='primary' onClick={this.onSignUpClick} />
          )}
          <FeatureContainer>
            {this.features.map((f, i) => (
              <FeatureSection title={f.title} body={f.body} image={f.image} key={`feature-${i}`} />
            ))}
          </FeatureContainer>
          <BottomContainer>
            <BottomSection>
              <BottomSectionTitle>Features</BottomSectionTitle>
              <BottomSectionList>
                <li>Innovative new network stack</li>
                <li>
                  Support for fullscreen, borderless, and normal windowed mode with resolution
                  scaling
                </li>
                <li>Windows 7 and 10 support</li>
                <li>Observer mode, with up to 6 observers per game</li>
                <li>Lobby join alerts</li>
                <li>Web-based client for chat and community features</li>
                <li>Server-based map distribution and hosting</li>
                <li>Automatic replay saving</li>
              </BottomSectionList>
            </BottomSection>
            <BottomSection>
              <BottomSectionTitle>
                In the pipe <ComingSoonText>(coming soon)</ComingSoonText>
              </BottomSectionTitle>
              <BottomSectionList columnCount='2' columnGap='24px'>
                <li>Matchmaking</li>
                <li>Ranked ladder</li>
                <li>Custom map uploading</li>
                <li>Cloud-synced replays</li>
                <li>Configurable pixel scaling</li>
                <li>Live match streaming</li>
                <li>First person replays</li>
                <li>Player profiles and statistics</li>
                <li>Replay analysis</li>
                <li>Friends list</li>
              </BottomSectionList>
            </BottomSection>
          </BottomContainer>
        </SplashContainer>
        <ConnectedDialogOverlay />
      </ScrollableContent>
    )
  }

  onSignUpClick = () => {
    this.props.dispatch(push({ pathname: '/signup' }))
  }

  onDownloadClick = () => {
    this.props.dispatch(openDialog('download'))
  }
}
