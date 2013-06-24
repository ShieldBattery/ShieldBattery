{
  'targets': [
    {
      'target_name': 'psi',
      'include_dirs=': [
        '<(node_root_dir)/',
        '<(node_root_dir)/deps/node/src',
        '<(node_root_dir)/deps/node/deps/uv/include',
        '<(node_root_dir)/deps/node/deps/v8/include',
      ],
      'sources': [
        'src/module.cpp',
        # headers
      ],
      'dependencies': [
        '<(node_root_dir)/shieldbattery.gyp:common',
      ],
      # node-gyp + nodedir doesn't work right with relative paths, so we override that with our own
      # less general settings
      'libraries=': [ '-l<(node_root_dir)/$(Configuration)/psi.lib' ],
      'msvs_disabled_warnings': [ 4506 ],
    }
  ]
}
