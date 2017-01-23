const RallyPointManager =
    process.webpackEnv.SB_ENV === 'electron' ? require('./rally-point-manager').default : null

const manager = process.webpackEnv.SB_ENV === 'electron' ? new RallyPointManager() : null

export default manager
