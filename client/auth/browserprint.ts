let modulePromise: Promise<any>
let fpPromise: Promise<any> | undefined

export function initBrowserprint() {
  if (fpPromise) {
    return
  }

  fpPromise = new Promise(resolve => {
    if (!modulePromise) {
      const promise = import('@fingerprintjs/fingerprintjs')
      promise.then(fpjs => {
        fpjs.load({ monitoring: false }).then(fp => resolve(fp))
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
