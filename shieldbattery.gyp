{
  'variables': {
    'library': 'static_library',
  },

  'target_defaults': {
    'default_configuration': 'Debug',
    'configurations': {
      'Debug': {
        'defines': [ 'DEBUG', '_DEBUG' ],
        'msvs_settings': {
          'VCCLCompilerTool': {
            'RuntimeLibrary': 1, # static debug
            'Optimization': 0, # /Od, no optimization
            'MinimalRebuild': 'false',
            'OmitFramePointers': 'false',
            'BasicRuntimeChecks': 3, # /RTC1
          },
          'VCLinkerTool': {
            'LinkIncremental': 2, # enable incremental linking
          },
        },
      },
      'Release': {
        'defines': [ 'NDEBUG' ],
        'msvs_settings': {
          'VCCLCompilerTool': {
            'RuntimeLibrary': 0, # static release
            'Optimization': 3, # /Ox, full optimization
            'FavorSizeOrSpeed': 1, # /Ot, favour speed over size
            'InlineFunctionExpansion': 2, # /Ob2, inline anything eligible
            'WholeProgramOptimization': 'true', # /GL, whole program optimization, needed for LTCG
            'OmitFramePointers': 'true',
            'EnableFunctionLevelLinking': 'true',
            'EnableIntrinsicFunctions': 'true',
          },
          'VCLibrarianTool': {
            'AdditionalOptions': [
              '/LTCG', # link time code generation
            ],
          },
          'VCLinkerTool': {
            'LinkTimeCodeGeneration': 1, # link-time code generation
            'OptimizeReferences': 2, # /OPT:REF
            'EnableCOMDATFolding': 2, # /OPT:ICF
            'LinkIncremental': 1, # disable incremental linking
          },
        },
      },
    },
    'msvs_settings': {
      'VCCLCompilerTool': {
        'StringPooling': 'true', # pool string literals
        'DebugInformationFormat': 3, # Generate a PDB
        'WarningLevel': 3,
        'BufferSecurityCheck': 'true',
        'ExceptionHandling': 1, # /EHsc
        'SuppressStartupBanner': 'true',
        'WarnAsError': 'false',
        'AdditionalOptions': [
           '/MP', # compile across multiple CPUs
         ],
      },
      'VCLibrarianTool': {
      },
      'VCLinkerTool': {
        'GenerateDebugInformation': 'true',
        'RandomizedBaseAddress': 2, # enable ASLR
        'DataExecutionPrevention': 2, # enable DEP
        'AllowIsolation': 'true',
        'SuppressStartupBanner': 'true',
        'target_conditions': [
          ['_type=="executable"', {
            'SubSystem': 1, # console executable
          }],
        ],
      },
    },
    'msvs_disabled_warnings': [ 4221, 4068 ],
    'defines': [
      'WIN32',
      '_WIN32_WINNT=0x0600', # minimum version is Windows Vista
    ],
  },

  'targets': [
    {
      'target_name': 'shieldbattery',
      'type': 'shared_library',
      'include_dirs': [
        '.',
        'deps/node/src',
        'deps/node/deps/uv/include',
        'deps/node/deps/v8/include',
      ],
      'sources': [
        'shieldbattery/shieldbattery.cpp',
        # headers
        'shieldbattery/shieldbattery.h',
      ],
      'msbuild_props': [
        '$(SolutionDir)shieldbattery/shieldbattery.props',
      ],
      'dependencies': [
        'common',
        'deps/node/node.gyp:node',
      ],
    },

    {
      'target_name': 'common',
      'type': 'static_library',
      'include_dirs': [
        '.',
      ],
      'sources': [
        'common/func_hook.cpp',
        'common/win_helpers.cpp',
        'common/win_thread.cpp',
        # headers
        'common/func_hook.h',
        'common/types.h',
        'common/win_helpers.h',
        'common/win_thread.h',
      ],
    },

    {
      'target_name': 'snp',
      'type': 'shared_library',
      'include_dirs': [
        '.',
      ],
      'sources': [
        'snp/functions.cpp',
        'snp/net_manager.cpp',
        'snp/snp.cpp',
        # headers
        'snp/functions.h',
        'snp/net_manager.h',
        'snp/packets.h',
        'snp/snp.h',
        # exports
        'snp/snp.def',
      ],
      'link_settings': {
        'libraries': [
          '-lws2_32.lib',
        ],
      },
      'msbuild_props': [
        '$(SolutionDir)snp/snp.props',
      ],
      'dependencies': [
        'common',
      ],
    },

    {
      'target_name': 'scout',
      'type': 'shared_library',
      'include_dirs': [
        '.',
      ],
      'sources': [
        'scout/scout.cpp',
      ],
      'dependencies': [
        'common',
      ],
    },

    {
      'target_name': 'psi',
      'type': 'executable',
      'include_dirs': [
        '.',
        'deps/node/src',
        'deps/node/deps/uv/include',
        'deps/node/deps/v8/include',
      ],
      'sources': [
        'psi/psi.cpp',
        # headers
        'psi/psi.h',
      ],
      'msbuild_props': [
        '$(SolutionDir)psi/psi.props',
      ],
      'dependencies': [
        'common',
        'deps/node/node.gyp:node',
      ],
    },

    # Node native modules
    {
      'target_name': 'node-bw',
      'type': 'shared_library',
      'include_dirs': [
        '.',
        'deps/node/src',
        'deps/node/deps/uv/include',
        'deps/node/deps/v8/include',
      ],
      'sources': [
        'node-bw/src/module.cpp',
        'node-bw/src/brood_war.cpp',
        'node-bw/src/wrapped_brood_war.cpp',
        # headers
        'node-bw/src/brood_war.h',
        'node-bw/src/wrapped_brood_war.h',
      ],
      'dependencies': [
        'common',
        'shieldbattery',
      ],
      'msvs_disabled_warnings': [ 4506, 4251 ],
      'product_prefix': '',
      'product_name': 'bw',
      'product_extension': 'node',
      'msvs_configuration_attributes': {
        'OutputDirectory': '$(SolutionDir)node-bw/$(Configuration)/',
      },
      'msbuild_props': [
        '$(SolutionDir)node-natives.props',
      ],
      'defines': [
        'BUILDING_NODE_EXTENSION',
      ],
    },

    {
      'target_name': 'node-psi',
      'type': 'shared_library',
      'include_dirs': [
        '.',
        'deps/node/src',
        'deps/node/deps/uv/include',
        'deps/node/deps/v8/include',
      ],
      'sources': [
        'node-psi/src/module.cpp',
      ],
      'dependencies': [
        'common',
        'psi',
      ],
      'msvs_disabled_warnings': [ 4506, 4251 ],
      'product_prefix': '',
      'product_name': 'psi',
      'product_extension': 'node',
      'msvs_configuration_attributes': {
        'OutputDirectory': '$(SolutionDir)node-psi/$(Configuration)/',
      },
      'msbuild_props': [
        '$(SolutionDir)node-natives.props',
      ],
      'defines': [
        'BUILDING_NODE_EXTENSION',
      ],
    },
  ],
}
