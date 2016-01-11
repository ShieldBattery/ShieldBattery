{
  'variables': {
    'library': 'static_library',
    # For whatever reason, VS likes to optimize away the builtins initialization functions in the
    # node static lib, so we have to force references to all of them in any of our executables that
    # utilize node
    'forced_references': [
      '__register_async_wrap_',
      '__register_buffer_',
      '__register_cares_wrap_',
      '__register_contextify_',
      '__register_crypto_',
      '__register_fs_',
      '__register_fs_event_wrap_',
      '__register_http_parser_',
      '__register_js_stream_',
      '__register_os_',
      '__register_pipe_wrap_',
      '__register_process_wrap_',
      '__register_signal_wrap_',
      '__register_spawn_sync_',
      '__register_stream_wrap_',
      '__register_tcp_wrap_',
      '__register_timer_wrap_',
      '__register_tls_wrap_',
      '__register_tty_wrap_',
      '__register_udp_wrap_',
      '__register_util_',
      '__register_uv_',
      '__register_v8_',
      '__register_zlib_',
    ]
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
        # Prevent VS from overwriting .obj files if two files in different dirs have the same name
        'ObjectFile': '$(IntDir)%(RelativeDir)',
      },
      'VCLibrarianTool': {
        'TargetMachine': 1, # X86
      },
      'VCLinkerTool': {
        'LinkIncremental': 2, # enable incremental linking
        'GenerateDebugInformation': 'true',
        'RandomizedBaseAddress': 2, # enable ASLR
        'DataExecutionPrevention': 2, # enable DEP
        'AllowIsolation': 'true',
        'SuppressStartupBanner': 'true',
      },
    },
    'msvs_disabled_warnings': [ 4221, 4068 ],
    'defines': [
      'WIN32',
      '_WIN32_WINNT=0x0600', # match libuv
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
        'nan/<!(cd nan && node -e "require(\'nan\')")',
        '$(DXSDK_DIR)Include',
      ],
      'sources': [
        'forge/indirect_draw.cpp',
        'forge/indirect_draw_palette.cpp',
        'forge/indirect_draw_surface.cpp',
        'forge/forge.cpp',
        'forge/module.cpp',
        'forge/direct_x.cpp',
        'forge/open_gl.cpp',
        'forge/renderer_utils.cpp',

        'node-bw/module.cpp',
        'node-bw/brood_war.cpp',
        'node-bw/immediate.cpp',
        'node-bw/wrapped_brood_war.cpp',

        'shieldbattery/shieldbattery.cpp',
        # headers
        'forge/indirect_draw.h',
        'forge/forge.h',
        'forge/direct_x.h',
        'forge/open_gl.h',
        'forge/renderer.h',
        'forge/renderer_utils.h',

        'node-bw/brood_war.h',
        'node-bw/forge_interface.h',
        'node-bw/immediate.h',
        'node-bw/wrapped_brood_war.h',

        'shieldbattery/settings.h',
        'shieldbattery/shieldbattery.h',
        'shieldbattery/snp_interface.h',
      ],
      'msbuild_props': [
        '$(SolutionDir)shieldbattery/shieldbattery.props',
      ],
      'defines': [
        'WIN32_LEAN_AND_MEAN',
      ],
      'dependencies': [
        'common',
        'logger',
        'v8-helpers',
        'deps/node/node.gyp:node',
        'deps/glew/glew.gyp:glew',
      ],
      'link_settings': {
        'libraries': [ '-luser32.lib', '-lgdi32.lib', '-lD3D10.lib', '-ld3dcompiler.lib' ],
        'library_dirs': [ '$(DXSDK_DIR)Lib/x86' ],
      },
      'msvs_disabled_warnings': [ 4506, 4251, 4530, 4838, 4996 ],
      'msvs_settings': {
        'VCLinkerTool': {
          'DelayLoadDLLs': ['opengl32.dll', 'd3d10.dll', 'd3dcompiler_43.dll'],
          'ForceSymbolReferences': [ '<@(forced_references)' ],
        },
      },
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
        'common/macros.h',
        'common/types.h',
        'common/win_helpers.h',
        'common/win_thread.h',
      ],
      'direct_dependent_settings': {
        'libraries': [ '-ladvapi32.lib', '-lWtsapi32.lib', '-luser32.lib' ],
      },
      'dependencies': [
        'deps/udis86/udis86.gyp:libudis86'
      ],
      'msvs_disabled_warnings': [ 4996 ],
    },

    {
      'target_name': 'v8-helpers',
      'type': 'static_library',
      'sources': [
        'v8-helpers/helpers.cpp',
        # headers
        'v8-helpers/helpers.h',
      ],
      'include_dirs': [
        '.',
        'deps/node/src',
        'deps/node/deps/uv/include',
        'deps/node/deps/v8/include',
        'nan/<!(cd nan && node -e "require(\'nan\')")',
      ],
      'defines': [
        'WIN32_LEAN_AND_MEAN',
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
        'WIN32_LEAN_AND_MEAN',
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
        'nan/<!(cd nan && node -e "require(\'nan\')")',
      ],
      'sources': [
        'node-psi/module.cpp',
        'node-psi/wrapped_process.cpp',
        'node-psi/wrapped_registry.cpp',

        'psi/psi.cpp',

        # headers
        'node-psi/module.h',
        'node-psi/wrapped_process.h',
        'node-psi/wrapped_registry.h',

        'psi/psi.h',
      ],
      'msbuild_props': [
        '$(SolutionDir)psi/psi.props',
      ],
      'dependencies': [
        'common',
        'v8-helpers',
        'deps/node/node.gyp:node',
      ],
      'msvs_disabled_warnings': [ 4506, 4251, 4530 ],
      'msvs_settings': {
        'VCLinkerTool': {
          'ForceSymbolReferences': [ '<@(forced_references)' ],
        },
      },
      'libraries': [ '-luser32.lib' ],
    },

    {
      'target_name': 'psi-emitter',
      'type': 'executable',
      'include_dirs': [
        '.',
      ],
      'msvs_settings': {
        'VCLinkerTool': {
          'target_conditions': [
            # in a target_conditions so it executes late and overrides includes
            ['_type=="executable"', {
              'AdditionalOptions=': [ '/SubSystem:Windows' ],
            }],
          ],
        },
      },
      'sources': [
        'psi-emitter/psi-emitter.cpp',
        # headers
        'psi-emitter/psi-emitter.h',
      ],
      'msbuild_props': [
        '$(SolutionDir)psi-emitter/psi-emitter.props',
      ],
      'dependencies': [
        'common',
      ],
      'libraries': [ '-luser32.lib', '-lshell32.lib' ],
    },
  ],
}
