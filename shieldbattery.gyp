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
      '_WIN32_WINNT=0x0502', # minimum version is Windows XP SP2 (matching libuv's claims)
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
        'shieldbattery/snp_interface.h',
      ],
      'msbuild_props': [
        '$(SolutionDir)shieldbattery/shieldbattery.props',
      ],
      'dependencies': [
        'common',
        'logger',
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
      'direct_dependent_settings': {
        'libraries': [ '-ladvapi32.lib', ],
      },
      'dependencies': [
        'deps/udis86/udis86.gyp:libudis86'
      ],
    },

    {
      # this target should only be used in node extensions. node hosts (shieldbattery, psi) would
      # need a separate target without the defines
      'target_name': 'v8-helpers',
      'type': 'static_library',
      'sources': [
        'v8-helpers/helpers.cpp',
        # headers
        'v8-helpers/helpers.h',
      ],
      'include_dirs': [
        '.',
        'deps/node/deps/v8/include',
      ],
      'defines': [
        'USING_UV_SHARED=1',
        'USING_V8_SHARED=1',
      ],
      'defines!': [
        'BUILDING_UV_SHARED=1',
        'BUILDING_V8_SHARED=1',
      ],
    },

    {
      'target_name': 'logger',
      'type': 'static_library',
      'sources': [
        'logger/logger.cpp',
        # headers
        'logger/logger.h',
      ],
      'include_dirs': [
        '.',
        'deps/node/src',
        'deps/node/deps/uv/include',
        'deps/node/deps/v8/include',
      ],
    },

    {
      'target_name': 'snp',
      'type': 'shared_library',
      'include_dirs': [
        '.',
        'deps/node/src',
        'deps/node/deps/uv/include',
        'deps/node/deps/v8/include',
      ],
      'sources': [
        'snp/functions.cpp',
        'snp/sockets.cpp',
        'snp/snp.cpp',
        # headers
        'snp/functions.h',
        'snp/packets.h',
        'snp/sockets.h',
        'snp/snp.h',
        # exports
        'snp/snp.def',
      ],
      'link_settings': {
        'libraries': [
          '-lws2_32.lib',
          '-l$(SolutionDir)$(Configuration)/shieldbattery.lib',
        ],
      },
      'msbuild_props': [
        '$(SolutionDir)snp/snp.props',
      ],
      'dependencies': [
        'common',
        'shieldbattery',
      ],
      'defines': [
        'BUILDING_NODE_EXTENSION',
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
        'node-bw/module.cpp',
        'node-bw/brood_war.cpp',
        'node-bw/immediate.cpp',
        'node-bw/wrapped_brood_war.cpp',
        # headers
        'node-bw/brood_war.h',
        'node-bw/immediate.h',
        'node-bw/wrapped_brood_war.h',
      ],
      'dependencies': [
        'common',
        'v8-helpers',
        'shieldbattery',
      ],
      'msvs_disabled_warnings': [ 4506, 4251, 4530 ],
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
      'libraries': [ '-luser32.lib'],
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
        'node-psi/module.cpp',
        'node-psi/wrapped_process.cpp',
        'node-psi/wrapped_registry.cpp',
        # headers
        'node-psi/module.h',
        'node-psi/wrapped_process.h',
        'node-psi/wrapped_registry.h',
      ],
      'dependencies': [
        'common',
        'v8-helpers',
        'psi',
      ],
      'msvs_disabled_warnings': [ 4506, 4251, 4530 ],
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
      # for reasons I don't quite understand, VS doesn't want to link in the lib from an exe, so we
      # have to manually specify it even though its alread a project dependency
      'libraries': [ '-l$(SolutionDir)$(Configuration)/psi.lib'],
    },

    {
      'target_name': 'forge',
      'type': 'shared_library',
      'include_dirs': [
        '.',
        'deps/node/src',
        'deps/node/deps/uv/include',
        'deps/node/deps/v8/include',
      ],
      'sources': [
        'forge/direct_glaw.cpp',
        'forge/forge.cpp',
        'forge/module.cpp',
        # headers
        'forge/direct_glaw.h',
        'forge/forge.h',
      ],
      'dependencies': [
        'common',
        'v8-helpers',
        'shieldbattery',
      ],
      'msvs_disabled_warnings': [ 4506, 4251, 4530 ],
      'product_prefix': '',
      'product_name': 'forge',
      'product_extension': 'node',
      'msvs_configuration_attributes': {
        'OutputDirectory': '$(SolutionDir)forge/$(Configuration)/',
      },
      'msbuild_props': [
        '$(SolutionDir)node-natives.props',
      ],
      'defines': [
        'BUILDING_NODE_EXTENSION',
      ],
      'libraries': [ '-luser32.lib'],
    },
  ],
}
