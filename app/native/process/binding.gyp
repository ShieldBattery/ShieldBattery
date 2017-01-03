{
  'targets': [
    {
      'target_name': 'win-process',
      'sources': [
        'v8_string.h',
        'wrapped_process.h',

        'module.cpp',
        'v8_string.cpp',
        'wrapped_process.cpp',
      ],
      'include_dirs': [
        '<!(node -e "require(\'nan\')")',
      ],
      'libraries': [
        '-ldbghelp.lib',
      ],
    },

    {
      'target_name': 'action_after_build',
      'type': 'none',
      'dependencies': ['win-process'],
      'copies': [
        {
          'files': [ '<(PRODUCT_DIR)/win-process.node' ],
          'destination': '.',
        },
      ],
    },
  ],
}
