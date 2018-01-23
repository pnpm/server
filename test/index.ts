import fs = require('mz/fs')
import path = require('path')

import test = require('tape')
import {
  createServer,
  connectStoreController,
 } from '@pnpm/server'
import {
  PackageFilesResponse,
} from '@pnpm/package-requester'
import got = require('got')
import isPortReachable = require('is-port-reachable')
import createResolver from '@pnpm/npm-resolver'
import createFetcher from '@pnpm/tarball-fetcher'
import createStore from 'package-store'

const registry = 'https://registry.npmjs.org/'

async function createStoreController () {
  const rawNpmConfig = { registry }
  const store = '.store'
  const resolve = createResolver({
    rawNpmConfig,
    store,
    metaCache: new Map<string, object>(),
  })
  const fetchers = createFetcher({
    alwaysAuth: true,
    registry,
    strictSsl: true,
    rawNpmConfig,
  })
  return await createStore(resolve, fetchers, {
    networkConcurrency: 1,
    store: store,
    locks: undefined,
    lockStaleDuration: 100,
  })
}

test('server', async t => {
  const port = 5813
  const hostname = '127.0.0.1'
  const remotePrefix = `http://${hostname}:${port}`
  const storeCtrlForServer = await createStoreController()
  const server = createServer(storeCtrlForServer, {
    hostname,
    port,
  })
  const storeCtrl = await connectStoreController({remotePrefix, concurrency: 100})
  const response = await storeCtrl.requestPackage(
    {alias: 'is-positive', pref: '1.0.0'},
    {
      downloadPriority: 0,
      loggedPkg: {rawSpec: 'sfdf'},
      prefix: process.cwd(),
      registry,
      verifyStoreIntegrity: false,
      preferredVersions: {},
    }
  )

  t.equal(response.body.id, 'registry.npmjs.org/is-positive/1.0.0', 'responded with correct ID')

  t.equal(response.body['manifest'].name, 'is-positive', 'responded with correct name in manifest')
  t.equal(response.body['manifest'].version, '1.0.0', 'responded with correct version in manifest')

  const files = await response['fetchingFiles'] as PackageFilesResponse
  t.notOk(files.fromStore)
  t.ok(files.filenames.indexOf('package.json') !== -1)
  t.ok(response['finishing'])

  await response['finishing']

  await server.close()
  await storeCtrl.close()
  t.end()
})

test('server upload', async t => {
  const port = 5813
  const hostname = '127.0.0.1'
  const remotePrefix = `http://${hostname}:${port}`
  const storeCtrlForServer = await createStoreController()
  const server = createServer(storeCtrlForServer, {
    hostname,
    port,
  })
  const storeCtrl = await connectStoreController({remotePrefix, concurrency: 100})

  const fakeEngine = 'client-engine'
  const fakePkgId = 'test.example.com/fake-pkg/1.0.0'

  await storeCtrl.upload(path.join(__dirname, 'side-effect-fake-dir'), {
    engine: fakeEngine,
    pkgId: fakePkgId,
  })

  const cachePath = path.join('.store', fakePkgId, 'side_effects', fakeEngine, 'package')
  t.ok(await fs.exists(cachePath), 'cache directory created')
  t.deepEqual(await fs.readdir(cachePath), ['side-effect.js', 'side-effect.txt'], 'all files uploaded to cache')

  await server.close()
  await storeCtrl.close()
  t.end()
})

test('stop server with remote call', async t => {
  const port = 5813
  const hostname = '127.0.0.1'
  const remotePrefix = `http://${hostname}:${port}`
  const storeCtrlForServer = await createStoreController()
  const server = createServer(storeCtrlForServer, {
    port,
    hostname,
    ignoreStopRequests: false,
  })

  t.ok(await isPortReachable(port), 'server is running')

  const response = await got(`${remotePrefix}/stop`, {method: 'POST'})

  t.equal(response.statusCode, 200, 'success returned by server stopping endpoint')

  t.notOk(await isPortReachable(port), 'server is not running')

  t.end()
})

test('disallow stop server with remote call', async t => {
  const port = 5813
  const hostname = '127.0.0.1'
  const remotePrefix = `http://${hostname}:${port}`
  const storeCtrlForServer = await createStoreController()
  const server = createServer(storeCtrlForServer, {
    port,
    hostname,
    ignoreStopRequests: true,
  })

  t.ok(await isPortReachable(port), 'server is running')

  try {
    const response = await got(`${remotePrefix}/stop`, {method: 'POST'})
    t.fail('request should have failed')
  } catch (err) {
    t.equal(err.statusCode, 403, 'server not stopped')
  }

  t.ok(await isPortReachable(port), 'server is running')

  await server.close()
  t.end()
})
