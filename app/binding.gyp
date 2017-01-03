{
  'targets': [
    {
      'target_name': 'build_all',
      'type': 'none',
      'dependencies': [
        # Include all binding.gyp files under ./native/
        "native/process/binding.gyp:*"
      ],
    },
  ],
}
