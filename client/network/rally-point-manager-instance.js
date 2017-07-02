const RallyPointManager = IS_ELECTRON ? require('./rally-point-manager').default : null

const manager = IS_ELECTRON ? new RallyPointManager() : null

export default manager
