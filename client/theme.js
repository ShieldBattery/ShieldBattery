import { Styles } from 'material-ui'
import Dark from 'material-ui/src/styles/themes/dark-theme'
let Colors = Styles.Colors

let theme = {
  getPalette() {
    let base = Dark.getPalette()
    return base
  },

  getComponentThemes(palette) {
    let base = Dark.getComponentThemes(palette)
    base.appBar = base.appBar || {}
    base.appBar.textColor = 'rgba(255,255,255,1)'
    return base
  }
}

export default theme
