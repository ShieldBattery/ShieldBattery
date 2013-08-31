# VS2012 will only use XP-compatible runtimes if you explicitly tell it to :(
{
  'target_defaults': {
    'msbuild_toolset': 'v110_xp',
  },
}
