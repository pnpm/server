import {
  PackageResponse,
  RequestPackageFunction,
  RequestPackageOptions,
  Resolution,
  WantedDependency,
} from '@pnpm/package-requester'

import request = require('request-promise-native')

import {StoreController} from 'package-store'
import uuid = require('uuid')

export default function (
  initOpts: {
    path: string;
  },
): Promise<StoreController> {
  const remotePrefix = `http://unix:${initOpts.path}:`

  return new Promise((resolve, reject) => {
    resolve({
      close: async () => { return },
      prune: async () => {
        await retryRequest({
          json: true,
          method: 'POST',
          url: `${remotePrefix}/prune`,
        })
      },
      requestPackage: requestPackage.bind(null, remotePrefix),
      saveState: async () => {
        await retryRequest({
          json: true,
          method: 'POST',
          url: `${remotePrefix}/saveState`,
        })
      },
      updateConnections: async (prefix: string, opts: {addDependencies: string[], removeDependencies: string[], prune: boolean}) => {
        await retryRequest({
          body: {
            opts,
            prefix,
          },
          json: true,
          method: 'POST',
          url: `${remotePrefix}/updateConnections`,
        })
      },
    })
  })
}

let inflightCount = 0
let errorCount = 0

function retryRequest (options: any): any { // tslint:disable-line
  if (inflightCount > 100) {
    return new Promise((resolve, reject) => {
      setTimeout(resolve, 100)
    }).then(() => {
      return retryRequest(options)
    })
  }
  inflightCount += 1
  return request(options).catch((e) => {
    inflightCount -= 1
    if (!e.message.startsWith('Error: connect ECONNRESET') && !e.message.startsWith('Error: connect ECONNREFUSED')) {
      throw e
    }
    console.log('again', errorCount++, inflightCount)
    return retryRequest(options)
  }).then((data) => {
    inflightCount -= 1
    return data
  })
}

function requestPackage (
  remotePrefix: string,
  wantedDependency: WantedDependency,
  options: RequestPackageOptions,
): Promise<PackageResponse> {
  const msgId = uuid.v4()

  return retryRequest({
    body: {
      msgId,
      options,
      wantedDependency,
    },
    json: true,
    method: 'POST',
    url: `${remotePrefix}/requestPackage`,
  })
  .then((packageResponse: PackageResponse) => {
    const fetchingManifest = retryRequest({
      body: {
        msgId,
      },
      json: true,
      method: 'POST',
      url: `${remotePrefix}/manifestResponse`,
    })
    const fetchingFiles = retryRequest({
      body: {
        msgId,
      },
      json: true,
      method: 'POST',
      url: `${remotePrefix}/packageFilesResponse`,
    })
    return Object.assign(packageResponse, {
      fetchingFiles,
      fetchingManifest,
      finishing: Promise.all([fetchingManifest, fetchingFiles]).then(() => undefined),
    })
  })
}
