let modulePromise: Promise<any> | undefined
let fpPromise: Promise<any> | undefined

export function initBrowserprint() {
  if (fpPromise) {
    return
  }

  fpPromise = new Promise((resolve, reject) => {
    if (modulePromise === undefined) {
      const promise = import('@fingerprintjs/fingerprintjs')
      promise
        .then(fpjs => fpjs.load({ monitoring: false }).then(fp => resolve(fp)))
        .catch(err => {
          reject(err)
        })
      modulePromise = promise
    }
  })
}

export async function getBrowserprint(): Promise<string> {
  if (!fpPromise) {
    initBrowserprint()
  }

  const fp = await fpPromise
  return (await fp.get()).visitorId
}
