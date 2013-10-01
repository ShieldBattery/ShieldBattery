{
  'targets': [
    {
      'target_name': 'glew',
      'type': 'static_library',
      'sources': [
        'src/glew.c',
      ],
      'include_dirs': [
        'include/',
      ],
      'defines': [
        'GLEW_STATIC',
      ],
      'direct_dependent_settings': {
        'include_dirs': [
          'include/',
        ],
        'defines': [
          'GLEW_STATIC',
        ],
        'libraries': [
          '-lglu32.lib',
          '-lopengl32.lib',
        ],
      },
    },
  ],
}
