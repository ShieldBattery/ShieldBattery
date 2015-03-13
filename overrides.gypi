{
  'target_defaults': {
    # VS2012 will only use XP-compatible runtimes if you explicitly tell it to :(
    'msbuild_toolset': 'v110_xp',
  },

  'variables': {
    'library_files+': [
      # The hook that gets Node to call our code when started
      'js/_third_party_main.js',
    ],
  },
}
