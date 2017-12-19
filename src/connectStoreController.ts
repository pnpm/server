import {
  PackageResponse,
  RequestPackageOptions,
  WantedDependency,
} from '@pnpm/package-requester'

import got = require('got')
import pLimit = require('p-limit')
import {StoreController} from 'package-store'
import uuid = require('uuid')

export default function (
  initOpts: {
    path: string;
  },
): Promise<StoreController> {
  const remotePrefix = `http://unix:${initOpts.path}:`
  const limitedRetryFetch = retryFetch.bind(null, pLimit(100))

  return new Promise((resolve, reject) => {
    resolve({
      close: async () => { return },
      prune: async () => {
        await limitedRetryFetch(`${remotePrefix}/prune`, {})
      },
      requestPackage: requestPackage.bind(null, remotePrefix, limitedRetryFetch),
      saveState: async () => {
        await limitedRetryFetch(`${remotePrefix}/saveState`, {})
      },
      updateConnections: async (prefix: string, opts: {addDependencies: string[], removeDependencies: string[], prune: boolean}) => {
        await limitedRetryFetch(`${remotePrefix}/updateConnections`, {
          opts,
          prefix,
        })
      },
    })
  })
}

function retryFetch (limit: (fn: () => PromiseLike<object>) => Promise<object>, url: string, body: object): Promise<object> { // tslint:disable-line
  return limit(async () => {
    const response = await got(url, {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    return JSON.parse(response.body)
  }).catch((e) => {
    if (!e.message.startsWith('Error: connect ECONNRESET') && !e.message.startsWith('Error: connect ECONNREFUSED')) {
      throw e
    }
    return retryFetch(limit, url, body)
  })
}

function requestPackage (
  remotePrefix: string,
  limitedRetryFetch: (url: string, body: object) => any, // tslint:disable-line
  wantedDependency: WantedDependency,
  options: RequestPackageOptions,
): Promise<PackageResponse> {
  const msgId = uuid.v4()

  return limitedRetryFetch(`${remotePrefix}/requestPackage`, {
    msgId,
    options,
    wantedDependency,
  })
  .then((packageResponse: PackageResponse) => {
    const fetchingManifest = limitedRetryFetch(`${remotePrefix}/manifestResponse`, {
      msgId,
    })
    const fetchingFiles = limitedRetryFetch(`${remotePrefix}/packageFilesResponse`, {
      msgId,
    })
    return Object.assign(packageResponse, {
      fetchingFiles,
      fetchingManifest,
      finishing: Promise.all([fetchingManifest, fetchingFiles]).then(() => undefined),
    })
  })
}
