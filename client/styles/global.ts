import { createGlobalStyle } from 'styled-components'
import { THEME_CSS } from './colors'
import { bodyMedium, inter } from './typography'

const GlobalStyle = createGlobalStyle`
  /**
    Helper property that can be used to resolve things like vw, cqw, etc. into usable values. Just
    assign your value to the property, then use the property in whatever calculatons you need.
  */
  @property --resolved-length {
    syntax: '<length>';
    inherits: false;
    initial-value: 0;
  }

  *, *::before, *::after {
    box-sizing: border-box;
    /**
      Generally allowing selection feels "un-app-like". For certain components, selection makes
      sense (e.g. predominantly text-based things, like chat boxes), but those are in the minority
      for us, so we make them specifically note themselves as exceptions to the rule.
    */
    user-select: none;
  }

  :root {
    ${THEME_CSS};
    --scrollbar-width: 16px;
  }

  html {
    ${inter};
    ${bodyMedium};

    accent-color: var(--theme-amber);
    font-optical-sizing: auto;
    font-weight: normal;
    color: var(--theme-on-surface);
    font-size: 14px;
    line-height: 1.42857;

    background-color: var(--theme-surface);
    --sb-color-background: var(--theme-surface);

    /** This will be overridden on the body styles in Electron */
    --sb-system-bar-height: 0px;

    /**
      Values to adjust for if centering content so that the content's edges don't end up on
      half pixels.
    */
    // NOTE(tec27): Rounding seems very weird here, I know, BUT... Chrome seems to implement vw/vh
    // extremely literally from the spec, which defines them as e.g. "1vw = 1% of viewport width."
    // Thus, they pre-divide them by 100, and for some values (such as 954px):
    //  954 / 100 * 100 => 953.9999999
    // When this occurs, rem and mod by 2px can return 2px instead of the 0px they should. Other
    // browsers (e.g. Firefox) don't seem to have this issue.
    --pixel-shove-x: rem(round(100dvw, 0.25px), 2px);
    --pixel-shove-y: rem(round(100dvh, 0.25px), 2px);
  }

  html, body, #app {
    -webkit-text-size-adjust: 100%;
    -webkit-tap-highlight-color: rgba(0, 0, 0, 0);
    -webkit-touch-callout: none;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    position: relative;
    overflow: hidden;
  }

  a:link, a:visited {
    color: var(--color-amber70);
    text-decoration: none;
  }

  a:hover, a:active {
    color: var(--color-amber80);
    text-decoration: underline;
  }

  svg {
    fill: currentColor;
  }

  *:focus-visible {
    outline-color: var(--theme-grey-blue);
    outline-offset: 2px;
    outline-width: 3px;
  }

  input:-webkit-autofill {
    box-shadow: 0 0 0px 1000px var(--theme-container-highest) inset !important;
    -webkit-text-fill-color: var(--theme-on-surface) !important;
    caret-color: var(--theme-amber) !important;
  }

  /** Style default scrollbar (at least in Webkit-based browsers) */
  *::-webkit-scrollbar {
    box-sizing: border-box;
    width: 16px;
  }

  *::-webkit-scrollbar-track {
    box-sizing: border-box;
    background-color: rgb(from var(--color-grey-blue10) r g b / 80%);
    border-radius: 4px;
    border: 1px solid rgb(from var(--color-grey-blue30) r g b / 80%);
  }

  *::-webkit-scrollbar-thumb {
    box-sizing: border-box;
    width: 100%;
    border: 2px solid transparent;
    margin-left: auto;
    margin-right: auto;
    background-color: var(--color-grey-blue40);
    background-clip: padding-box;
    /**
     * NOTE(tec27): This is more than the "usual" because it is inside of something that already
     * has border-radius, this makes it appear to match the outer radius
     */
    border-radius: 6px;

    &:hover, &:active {
      background-color: var(--color-grey-blue50);
    }
  }

  *::-webkit-scrollbar-button:start:decrement,
  *::-webkit-scrollbar-button:end:increment {
    height: 0px;
  }
  /** End scrollbar styling */
`

export default GlobalStyle
