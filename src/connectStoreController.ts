import {
  PackageResponse,
  RequestPackageFunction,
  RequestPackageOptions,
  Resolution,
  WantedDependency,
} from '@pnpm/package-requester'

import pLimit = require('p-limit')
import request = require('request-promise-native')

import {StoreController} from 'package-store'
import uuid = require('uuid')

export default function (
  initOpts: {
    path: string;
  },
): Promise<StoreController> {
  const remotePrefix = `http://unix:${initOpts.path}:`
  const limitedRetryRequest = retryRequest.bind(null, pLimit(100))

  return new Promise((resolve, reject) => {
    resolve({
      close: async () => { return },
      prune: async () => {
        await limitedRetryRequest({
          json: true,
          method: 'POST',
          url: `${remotePrefix}/prune`,
        })
      },
      requestPackage: requestPackage.bind(null, remotePrefix, limitedRetryRequest),
      saveState: async () => {
        await limitedRetryRequest({
          json: true,
          method: 'POST',
          url: `${remotePrefix}/saveState`,
        })
      },
      updateConnections: async (prefix: string, opts: {addDependencies: string[], removeDependencies: string[], prune: boolean}) => {
        await limitedRetryRequest({
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

function retryRequest<T> (limit: (fn: () => PromiseLike<T>) => Promise<T>, options: any): any { // tslint:disable-line
  return limit(() => {
    return request(options)
  }).catch((e) => {
    if (!e.message.startsWith('Error: connect ECONNRESET') && !e.message.startsWith('Error: connect ECONNREFUSED')) {
      throw e
    }
    return retryRequest(limit, options)
  })
}

function requestPackage (
  remotePrefix: string,
  limitedRetryRequest: (options: any) => any, // tslint:disable-line
  wantedDependency: WantedDependency,
  options: RequestPackageOptions,
): Promise<PackageResponse> {
  const msgId = uuid.v4()

  return limitedRetryRequest({
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
    const fetchingManifest = limitedRetryRequest({
      body: {
        msgId,
      },
      json: true,
      method: 'POST',
      url: `${remotePrefix}/manifestResponse`,
    })
    const fetchingFiles = limitedRetryRequest({
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
