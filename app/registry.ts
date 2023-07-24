import Registry from 'winreg'

export {
  DEFAULT_VALUE,
  HKCC,
  HKCR,
  HKCU,
  HKLM,
  HKU,
  REG_BINARY,
  REG_DWORD,
  REG_EXPAND_SZ,
  REG_MULTI_SZ,
  REG_NONE,
  REG_QWORD,
  REG_SZ,
} from 'winreg'

export function readRegistryValue(
  hive: string,
  key: string,
  value: string,
): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const reg = new Registry({ hive, key })
    reg.get(value, (err, result) => {
      if (err) {
        reject(err)
      } else {
        resolve(result ? result.value : undefined)
      }
    })
  })
}

export function setRegistryValue({
  hive,
  key,
  name,
  type,
  value,
}: {
  hive: string
  key: string
  name: string
  type: string
  value: string
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const reg = new Registry({ hive, key })
    reg.set(name, type, value, err => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
  })
}
