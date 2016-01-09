{
  'target_defaults': {
    'msvs_settings': {
      'VCLibrarianTool': {
        # For whatever reason, the node target doesn't get this set correctly atm
        'TargetMachine': 1, # X86
      },
    },
  },

  'variables': {
    'library_files+': [
      # The hook that gets Node to call our code when started
      # TODO(tec27): use --link-module for this instead
      'js/_third_party_main.js',
    ],
  },
}
