import http = require('http')
import {IncomingMessage, Server, ServerResponse} from 'http'
import {StoreController} from 'package-store'

export default function (
  store: StoreController,
  opts: {
    path?: string,
    port?: number,
    hostname?: string,
  },
) {
  const manifestPromises = {}
  const filesPromises = {}

  const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST') {
      res.statusCode = 503
      res.end(JSON.stringify(`Only POST is allowed, received ${req.method}`))
      return
    }

    let body: any = '' // tslint:disable-line
    req.on('data', (data) => {
      body += data
    })
    req.on('end', async () => {
      try {
        if (body.length > 0) {
          body = JSON.parse(body)
        } else {
          body = {}
        }

        switch (req.url) {
          case '/requestPackage':
            const pkgResponse = await store.requestPackage(body.wantedDependency, body.options)
            if (!pkgResponse.isLocal) {
              manifestPromises[body.msgId] = pkgResponse.fetchingManifest
              filesPromises[body.msgId] = pkgResponse.fetchingFiles
            }
            res.end(JSON.stringify(pkgResponse))
            break
          case '/packageFilesResponse':
            const filesResponse = await filesPromises[body.msgId]
            delete filesPromises[body.msgId]
            res.end(JSON.stringify(filesResponse))
            break
          case '/manifestResponse':
            const manifestResponse = await manifestPromises[body.msgId]
            delete manifestPromises[body.msgId]
            res.end(JSON.stringify(manifestResponse))
            break
          case '/updateConnections':
            await store.updateConnections(body.prefix, body.opts)
            res.end(JSON.stringify('OK'))
            break
          case '/prune':
            await store.prune()
            res.end(JSON.stringify('OK'))
            break
          case '/saveState':
            await store.saveState()
            res.end(JSON.stringify('OK'))
            break
        }
      } catch (e) {
        res.statusCode = 503
        res.end(JSON.stringify(e.message))
      }
    })
  })

  let listener: Server;
  if (opts.path) {
    listener = server.listen(opts.path)
  } else {
    listener = server.listen(opts.port, opts.hostname)
  }

  return {
    close: () => listener.close(() => { return }),
  }
}
