import { createGlobalStyle } from 'styled-components'
import {
  amberA200,
  amberA400,
  CardLayer,
  colorBackground,
  colorTextFaint,
  colorTextPrimary,
  grey700,
  grey800,
} from './colors'

const GlobalStyle = createGlobalStyle`
  *, *::before, *::after {
    box-sizing: border-box;
    /**
      Generally allowing selection feels "un-app-like". For certain components, selection makes
      sense (e.g. predominantly text-based things, like chat boxes), but those are in the minority
      for us, so we make them specifically note themselves as exceptions to the rule.
    */
    user-select: none;
  }

  html {
    font-family: Roboto, sans-serif;
    font-weight: normal;
    color: ${colorTextPrimary};
    font-size: 14px;
    line-height: 1.5;
    background-color: ${colorBackground};
  }

  html, body, #app, #app > div {
    -webkit-text-size-adjust: 100%;
    -webkit-tap-highlight-color: rgba(0, 0, 0, 0);
    -webkit-touch-callout: none;
    height: 100%;
    margin: 0;
    padding: 0;
    position: relative;
  }

  [disabled] {
    color: ${colorTextFaint};
  }

  a:link, a:visited {
    color: ${amberA400};
    text-decoration: none;
  }

  a:hover, a:active {
    color: ${amberA200};
    text-decoration: underline;
  }

  svg {
    fill: currentColor;
  }

  input:-webkit-autofill {
    -webkit-box-shadow: 0 0 0px 1000px ${grey800} inset !important;
    -webkit-text-fill-color: ${colorTextPrimary} !important;
    caret-color: #fff !important;

    ${CardLayer} & {
      -webkit-box-shadow: 0 0 0px 1000px ${grey700} inset !important;
      -webkit-text-fill-color: ${colorTextPrimary} !important;
      caret-color: #fff !important;
    }
  }
`

export default GlobalStyle
