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
import { body1 } from './typography'

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
    ${body1};
    font-family: Inter, sans-serif;
    font-weight: normal;
    color: ${colorTextPrimary};
    font-size: 14px;
    line-height: 20px;
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
    box-shadow: 0 0 0px 1000px ${grey800} inset !important;
    -webkit-text-fill-color: ${colorTextPrimary} !important;
    caret-color: #fff !important;

    ${CardLayer} & {
      -webkit-box-shadow: 0 0 0px 1000px ${grey700} inset !important;
      box-shadow: 0 0 0px 1000px ${grey700} inset !important;
      -webkit-text-fill-color: ${colorTextPrimary} !important;
      caret-color: #fff !important;
    }
  }

  /** Style default scrollbar (at least in Webkit-based browsers) */
  *::-webkit-scrollbar {
    width: 16px;
  }

  *::-webkit-scrollbar-track {
    background-color: rgba(255, 255, 255, 0.08);
    border-radius: 2px;
  }

  *::-webkit-scrollbar-thumb {
    width: 100%;
    border: 2px solid transparent;
    margin-left: auto;
    margin-right: auto;
    background-color: rgba(255, 255, 255, 0.12);
    background-clip: padding-box;
    /**
     * NOTE(tec27): This is more than the "usual" because it is inside of something that already
     * has border-radius, this makes it appear to match the outer radius
     */
    border-radius: 4px;

    &:hover, &:active {
      background-color: rgba(255, 255, 255, 0.16);
    }
  }

  *::-webkit-scrollbar-button:start:decrement,
  *::-webkit-scrollbar-button:end:increment {
    height: 0px;
  }
  /** End scrollbar styling */

  /**
   * react-virtualized styles
   * These are copied out of the supplied styles.css so that we don't have to import/utilize CSS,
   * and have had their stylistic preferences stripped (only layout stuff is left).
   */
  .ReactVirtualized__Table__headerRow {
    display: flex;
    flex-direction: row;
    align-items: center;
  }
  .ReactVirtualized__Table__row {
    display: flex;
    flex-direction: row;
    align-items: center;
  }
  .ReactVirtualized__Table__headerTruncatedText {
    display: inline-block;
    max-width: 100%;
    overflow: hidden;
  }
  .ReactVirtualized__Table__sortableHeaderIconContainer {
    display: flex;
    align-items: center;
  }
  /* end react-virtualized */
`

export default GlobalStyle
