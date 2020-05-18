import { createGlobalStyle } from 'styled-components'

import {
  colorTextPrimary,
  colorTextFaint,
  colorBackground,
  amberA200,
  amberA400,
  grey700,
  grey800,
  CardLayer,
} from './colors'

const GlobalStyle = createGlobalStyle`
  *, *::before, *::after {
    box-sizing: border-box;
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
