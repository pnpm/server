import {
  RequestPackageFunction,
  RequestPackageOptions,
  WantedDependency,
} from '@pnpm/package-requester'

import bodyParser = require('body-parser')
import {Request, Response} from 'express';
import express = require('express')
import http = require('http')

import {StoreController} from 'package-store'

export default function (
  store: StoreController,
  opts: {
    path: string;
  },
) {
  const packageResponses = {}

  const app = express()
  app.use(bodyParser.json({
    limit: '10mb',
  }))

  app.post('/requestPackage', async (request: Request, response: Response) => {
    const {msgId, wantedDependency, options} = request.body
    if (!packageResponses[msgId]) {
      packageResponses[msgId] = await store.requestPackage(wantedDependency, options)
    }
    response.json(packageResponses[msgId])
  })

  app.post('/packageFilesResponse', async (request: Request, response: Response) => {
    const fetchingFiles = await packageResponses[request.body.msgId].fetchingFiles
    delete packageResponses[request.body.msgId].fetchingFiles
    garbageCollectResponses(packageResponses, request.body.msgId)
    response.json(fetchingFiles)
  })

  app.post('/manifestResponse', async (request: Request, response: Response) => {
    const fetchingManifest = await packageResponses[request.body.msgId].fetchingManifest
    delete packageResponses[request.body.msgId].fetchingManifest
    garbageCollectResponses(packageResponses, request.body.msgId)
    response.json(fetchingManifest)
  })

  app.post('/prune', async (request: Request, response: Response) => {
    await store.prune()
    response.json('OK')
  })

  app.post('/saveState', async (request: Request, response: Response) => {
    await store.saveState()
    response.json('OK')
  })

  app.post('/updateConnections', async (request: Request, response: Response) => {
    await store.updateConnections(request.body.prefix, request.body.opts)
    response.json('OK')
  })

  const listener = app.listen(opts.path)

  return {
    close: () => listener.close(() => { return }),
  }
}

function garbageCollectResponses (packageResponses: object, msgId: string) {
  if (!packageResponses[msgId].fetchingFiles && !packageResponses[msgId].fetchingManifest) {
    delete packageResponses[msgId]
  }
}
