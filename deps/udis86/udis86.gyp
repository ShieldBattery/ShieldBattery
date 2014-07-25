{
  'targets': [
    {
      'target_name': 'libudis86',
      'type': 'static_library',
      'sources': [
        'libudis86/decode.c',
        'libudis86/itab.c',
        'libudis86/syn.c',
        'libudis86/syn-att.c',
        'libudis86/syn-intel.c',
        'libudis86/udis86.c',
        # headers
        'udis86.h',
        'libudis86/decode.h',
        'libudis86/extern.h',
        'libudis86/itab.h',
        'libudis86/syn.h',
        'libudis86/types.h',
        'libudis86/udint.h',
      ],
      'direct_dependent_settings': {
        'include_dirs': [
          '.',
        ],
      },
    },
  ],
}
