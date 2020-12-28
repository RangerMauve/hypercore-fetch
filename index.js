const resolveDatPath = require('resolve-dat-path')
const Headers = require('fetch-headers')
const mime = require('mime/lite')
const SDK = require('dat-sdk')
const parseRange = require('range-parser')
const makeDir = require('make-dir')
const { Readable, Writable, pipelinePromise } = require('streamx')
const makeFetch = require('make-fetch')

const DAT_REGEX = /\w+:\/\/([^/]+)\/?([^#?]*)?/
const NUMBER_REGEX = /^\d+$/
const PROTOCOL_REGEX = /^\w+:\/\//
const NOT_WRITABLE_ERROR = 'Archive not writable'

const READABLE_ALLOW = ['GET', 'HEAD', 'TAGS', 'DOWNLOAD', 'CLEAR']
const WRITABLE_ALLOW = ['PUT', 'DELETE', 'TAG', 'TAG-DELETE']
const ALL_ALLOW = READABLE_ALLOW.concat(WRITABLE_ALLOW)

module.exports = function makeHyperFetch (opts = {}) {
  let { Hyperdrive, resolveName, base, writable = false } = opts

  let sdk = null
  let gettingSDK = null
  let onClose = async () => undefined

  const isSourceDat = base && (base.startsWith('dat://') || base.startsWith('hyper://'))

  const fetch = makeFetch(hyperFetch)

  fetch.close = () => onClose()

  return fetch

  async function hyperFetch ({ url, headers: rawHeaders, method, signal, body }) {
    const isDatURL = url.startsWith('dat://') || url.startsWith('hyper://')
    const urlHasProtocol = url.match(PROTOCOL_REGEX)

    const shouldIntercept = isDatURL || (!urlHasProtocol && isSourceDat)

    if (!shouldIntercept) throw new Error('Invalid protocol, must be dat:// or hyper://')

    const headers = new Headers(rawHeaders || {})

    const responseHeaders = {}
    responseHeaders['Access-Control-Allow-Origin'] = '*'
    responseHeaders['Allow-CSP-From'] = '*'
    responseHeaders['Access-Control-Allow-Headers'] = '*'
    responseHeaders['Cache-Control'] = 'no-cache'

    try {
      let { path, key, version } = parseDatURL(url)
      if (!path) path = '/'

      const resolve = await getResolve()

      try {
        key = await resolve(`dat://${key}`)
      } catch (e) {
        // Probably a domain that couldn't resolve
        if (key.includes('.')) throw e
      }

      const Hyperdrive = await getHyperdrive()

      let archive = Hyperdrive(key)

      await archive.ready()

      if (version) {
        if (NUMBER_REGEX.test(version)) {
          archive = await archive.checkout(version)
        } else {
          archive = await archive.checkout(await archive.getTaggedVersion(version))
        }
        await archive.ready()
      }

      const canonical = `hyper://${archive.key.toString('hex')}/${path || ''}`
      responseHeaders.Link = `<${canonical}>; rel="canonical"`

      const isWritable = writable && archive.writable
      const allowHeaders = isWritable ? ALL_ALLOW : READABLE_ALLOW
      responseHeaders.Allow = allowHeaders.join(', ')

      // We can say the file hasn't changed if the drive version hasn't changed
      responseHeaders.ETag = `"${archive.version}"`

      if (method === 'TAG') {
        const nameData = await collectBuffers(body)
        const name = nameData.toString('utf8')
        const tagVersion = archive.version

        await archive.createTag(name, tagVersion)
        responseHeaders['Content-Type'] = 'text/plain; charset=utf-8'

        return {
          statusCode: 200,
          headers: responseHeaders,
          data: intoAsyncIterable(`${tagVersion}`)
        }
      } else if (method === 'TAGS') {
        const tags = await archive.getAllTags()
        const tagsObject = Object.fromEntries(tags)
        const json = JSON.stringify(tagsObject, null, '\t')

        responseHeaders['Content-Type'] = 'application/json; charset=utf-8'

        return {
          statusCode: 200,
          headers: responseHeaders,
          data: intoAsyncIterable(json)
        }
      } else if (method === 'TAG-DELETE') {
        await archive.deleteTag(version)

        return {
          statusCode: 200,
          headers: responseHeaders,
          data: intoAsyncIterable('')
        }
      } if (method === 'DOWNLOAD') {
        await archive.download(path)
        return {
          statusCode: 200,
          headers: responseHeaders,
          data: intoAsyncIterable('')
        }
      } else if (method === 'CLEAR') {
        await archive.clear(path)
        return {
          statusCode: 200,
          headers: responseHeaders,
          data: intoAsyncIterable('')
        }
      } else if (method === 'PUT') {
        checkWritable(archive)
        if (path.endsWith('/')) {
          await makeDir(path, { fs: archive })
        } else {
          const parentDir = path.split('/').slice(0, -1).join('/')
          if (parentDir) {
            await makeDir(parentDir, { fs: archive })
          }
          // Create a new file from the request body
          const source = Readable.from(body)
          const destination = archive.createWriteStream(path)
          // The sink is needed because Hyperdrive's write stream is duplex
          const sink = new Writable({ write (_, cb) { cb() } })
          await pipelinePromise(
            source,
            destination,
            sink
          )
        }
        return {
          statusCode: 200,
          headers: responseHeaders,
          data: intoAsyncIterable('')
        }
      } else if (method === 'DELETE') {
        checkWritable(archive)

        const stats = await archive.stat(path)
        // Weird stuff happening up in here...
        const stat = Array.isArray(stats) ? stats[0] : stats

        if (stat.isDirectory()) {
          await archive.rmdir(path)
        } else {
          await archive.unlink(path)
        }
        return {
          statusCode: 200,
          headers: responseHeaders,
          data: intoAsyncIterable('')
        }
      } else if ((method === 'GET') || (method === 'HEAD')) {
        let stat = null
        let finalPath = path

        if (finalPath === '.well-known/dat') {
          const { key } = archive
          const entry = `dat://${key.toString('hex')}\nttl=3600`
          return {
            statusCode: 200,
            headers: responseHeaders,
            data: intoAsyncIterable(entry)
          }
        }
        try {
          if (headers.get('X-Resolve') === 'none') {
            [stat] = await archive.stat(path)
          } else {
            const resolved = await resolveDatPathAwait(archive, path)
            finalPath = resolved.path
            stat = resolved.stat
          }
        } catch (e) {
          responseHeaders['content-type'] = 'text/plain'
          return {
            statusCode: 404,
            headers: responseHeaders,
            data: intoAsyncIterable(e.stack)
          }
        }

        responseHeaders['Content-Type'] = getMimeType(finalPath)

        let data = null
        const isRanged = headers.get('Range') || headers.get('range')
        let statusCode = 200

        if (stat.isDirectory()) {
          const stats = await archive.readdir(finalPath, { includeStats: true })
          const files = stats.map(({ stat, name }) => (stat.isDirectory() ? `${name}/` : name))

          if (headers.get('Accept') === 'application/json') {
            const json = JSON.stringify(files, null, '\t')
            responseHeaders['Content-Type'] = 'application/json; charset=utf-8'
            data = intoAsyncIterable(json)
          } else {
            const page = `
        <!DOCTYPE html>
        <title>${url}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <h1>Index of ${path}</h1>
        <ul>
          <li><a href="../">../</a></li>${files.map((file) => `
          <li><a href="${file}">./${file}</a></li>
        `).join('')}
        </ul>
      `
            responseHeaders['Content-Type'] = 'text/html; charset=utf-8'
            data = intoAsyncIterable(page)
          }
        } else {
          responseHeaders['Accept-Ranges'] = 'bytes'

          try {
            const { blocks, downloadedBlocks } = await archive.stats(finalPath)
            responseHeaders['X-Blocks'] = `${blocks}`
            responseHeaders['X-Blocks-Downloaded'] = `${downloadedBlocks}`
          } catch (e) {
            // Don't worry about it, it's optional.
          }

          if (isRanged) {
            const { size } = stat
            const ranges = parseRange(size, isRanged)
            if (ranges && ranges.length && ranges.type === 'bytes') {
              statusCode = 206
              const [{ start, end }] = ranges
              const length = (end - start + 1)
              responseHeaders['Content-Length'] = `${length}`
              responseHeaders['Content-Range'] = `bytes ${start}-${end}/${size}`
              if (method !== 'HEAD') {
                data = archive.createReadStream(finalPath, {
                  start,
                  end
                })
              }
            } else {
              responseHeaders['Content-Length'] = `${size}`
              if (method !== 'HEAD') {
                data = archive.createReadStream(finalPath)
              }
            }
          } else if (method !== 'HEAD') {
            data = archive.createReadStream(finalPath)
          }
        }

        if (method === 'HEAD') {
          return {
            statusCode: 204,
            headers: responseHeaders,
            data: intoAsyncIterable('')
          }
        } else {
          return {
            statusCode,
            headers: responseHeaders,
            data
          }
        }
      } else {
        return {
          statusCode: 405,
          headers: responseHeaders,
          data: intoAsyncIterable('Method Not Allowed')
        }
      }
    } catch (e) {
      const isUnauthorized = (e.message === NOT_WRITABLE_ERROR)
      const statusCode = isUnauthorized ? 403 : 500
      const statusText = isUnauthorized ? 'Not Authorized' : 'Server Error'
      return {
        statusCode,
        statusText,
        headers: responseHeaders,
        data: intoAsyncIterable(e.stack)
      }
    }
  }

  function getResolve () {
    if (resolveName) return resolveName
    return getSDK().then(({ resolveName }) => resolveName)
  }

  function getHyperdrive () {
    if (Hyperdrive) return Hyperdrive
    return getSDK().then(({ Hyperdrive }) => Hyperdrive)
  }

  function getSDK () {
    if (sdk) return Promise.resolve(sdk)
    if (gettingSDK) return gettingSDK
    return SDK(opts).then((gotSDK) => {
      sdk = gotSDK
      gettingSDK = null
      onClose = async () => sdk.close()
      Hyperdrive = sdk.Hyperdrive
      resolveName = sdk.resolveName

      return sdk
    })
  }

  function resolveDatPathAwait (archive, path) {
    return new Promise((resolve, reject) => {
      resolveDatPath(archive, path, (err, resolved) => {
        if (err) reject(err)
        else resolve(resolved)
      })
    })
  }

  function checkWritable (archive) {
    if (!writable) throw new Error(NOT_WRITABLE_ERROR)
    if (!archive.writable) {
      throw new Error(NOT_WRITABLE_ERROR)
    }
  }
}

function parseDatURL (url) {
  let [, key, path] = url.toString().match(DAT_REGEX)
  let version = null
  if (key.includes('+')) [key, version] = key.split('+')

  return {
    key,
    path,
    version
  }
}

async function * intoAsyncIterable (data) {
  yield Buffer.from(data)
}

async function collectBuffers (iterable) {
  const all = []
  for await (const buff of iterable) {
    all.push(Buffer.from(buff))
  }

  return Buffer.concat(all)
}

function getMimeType (path) {
  let mimeType = mime.getType(path) || 'text/plain'
  if (mimeType.startsWith('text/')) mimeType = `${mimeType}; charset=utf-8`
  return mimeType
}
