const resolveDatPath = require('resolve-dat-path')
const Headers = require('fetch-headers')
const mime = require('mime/lite')
const concat = require('concat-stream')
const SDK = require('dat-sdk')
const { Readable } = require('stream')
const parseRange = require('range-parser')
const bodyToStream = require('fetch-request-body-to-stream')
const pump = require('pump-promise')
const makeDir = require('make-dir')

const DAT_REGEX = /\w+:\/\/([^/]+)\/?([^#?]*)?/
const NOT_WRITABLE_ERROR = 'Archive not writable'

const READABLE_ALLOW = ['GET', 'HEAD', 'DOWNLOAD', 'CLEAR']
const WRITABLE_ALLOW = ['PUT', 'DELETE']
const ALL_ALLOW = READABLE_ALLOW.concat(WRITABLE_ALLOW)

module.exports = function makeFetch (opts = {}) {
  let { Hyperdrive, resolveName, base, session, writable = false } = opts

  let sdk = null
  let gettingSDK = null
  let onClose = async () => undefined

  const isSourceDat = base && (base.startsWith('dat://') || base.startsWith('hyper://'))

  datFetch.close = () => onClose()

  return datFetch

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

  async function datFetch (url, opts = {}) {
    if (typeof url !== 'string') {
      opts = url
      url = opts.url
    }

    const isDatURL = url.startsWith('dat://') || url.startsWith('hyper://')
    const urlHasProtocol = url.match(/^\w+:\/\//)

    const shouldIntercept = isDatURL || (!urlHasProtocol && isSourceDat)

    if (!shouldIntercept) throw new Error('Invalid protocol, must be dat:// or hyper://')

    const { headers: rawHeaders, method: rawMethod } = opts
    const headers = new Headers(rawHeaders || {})
    const method = rawMethod ? rawMethod.toUpperCase() : 'GET'

    const responseHeaders = new Headers()
    responseHeaders.set('Access-Control-Allow-Origin', '*')
    responseHeaders.set('Allow-CSP-From', '*')
    responseHeaders.set('Access-Control-Allow-Headers', '*')
    responseHeaders.set('Cache-Control', 'no-cache')

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
        archive = archive.checkout(await archive.getTaggedVersion(version))
        await archive.ready()
      }

      const canonical = `hyper://${archive.key.toString('hex')}/${path || ''}`
      responseHeaders.append('Link', `<${canonical}>; rel="canonical"`)

      const isWritable = writable && archive.writable
      const allowHeaders = isWritable ? ALL_ALLOW : READABLE_ALLOW
      responseHeaders.set('Allow', allowHeaders.join(', '))

      // We can say the file hasn't changed if the drive version hasn't changed
      responseHeaders.set('ETag', `"${archive.version}"`)

      if (method === 'TAG') {
        const { body } = opts
        const name = (await concatPromise(bodyToStream(body, session))).toString('utf8')
        const tagVersion = archive.version

        await archive.createTag(name, tagVersion)
        responseHeaders.set('Content-Type', 'text/plain; charset=utf-8')

        return new FakeResponse(200, 'ok', responseHeaders, intoStream(`${tagVersion}`), url)
      } else if (method === 'TAGS') {
        const tags = await archive.getAllTags()
        const tagsObject = Object.fromEntries(tags)
        const json = JSON.stringify(tagsObject, null, '\t')

        responseHeaders.set('Content-Type', 'application/json; charset=utf-8')

        return new FakeResponse(200, 'ok', responseHeaders, intoStream(Buffer.from(json)), url)
      } else if (method === 'TAG-DELETE') {
        await archive.deleteTag(version)

        return new FakeResponse(200, 'ok', responseHeaders, intoStream(''), url)
      } if (method === 'DOWNLOAD') {
        await archive.download(path)
        return new FakeResponse(200, 'ok', responseHeaders, intoStream(''), url)
      } else if (method === 'CLEAR') {
        await archive.clear(path)
        return new FakeResponse(200, 'ok', responseHeaders, intoStream(''), url)
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
          const { body } = opts
          const source = bodyToStream(body, session)
          const destination = archive.createWriteStream(path)

          await pump(source, destination)
        }
        return new FakeResponse(200, 'OK', responseHeaders, intoStream(''), url)
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

        return new FakeResponse(200, 'OK', responseHeaders, intoStream(''), url)
      } else if ((method === 'GET') || (method === 'HEAD')) {
        let stat = null
        let finalPath = path

        if (finalPath === '.well-known/dat') {
          const { key } = archive
          const entry = `dat://${key.toString('hex')}\nttl=3600`
          return new FakeResponse(200, 'OK', responseHeaders, intoStream(entry), url)
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
          return new FakeResponse(
            404,
            'Not Found',
            new Headers([
              'content-type', 'text/plain'
            ]),
            intoStream(e.stack),
            url)
        }

        responseHeaders.set('Content-Type', getMimeType(finalPath))

        let stream = null
        const isRanged = headers.get('Range') || headers.get('range')
        let statusCode = 200

        if (stat.isDirectory()) {
          const stats = await archive.readdir(finalPath, { includeStats: true })
          const files = stats.map(({ stat, name }) => (stat.isDirectory() ? `${name}/` : name))

          if (headers.get('Accept') === 'application/json') {
            const json = JSON.stringify(files, null, '\t')
            responseHeaders.set('Content-Type', 'application/json; charset=utf-8')
            stream = intoStream(Buffer.from(json))
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
            responseHeaders.set('Content-Type', 'text/html; charset=utf-8')
            const buffer = Buffer.from(page)
            stream = intoStream(buffer)
          }
        } else {
          responseHeaders.set('Accept-Ranges', 'bytes')

          try {
            const { blocks, downloadedBlocks } = await archive.stats(finalPath)
            responseHeaders.set('X-Blocks', `${blocks}`)
            responseHeaders.set('X-Blocks-Downloaded', `${downloadedBlocks}`)
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
              responseHeaders.set('Content-Length', `${length}`)
              responseHeaders.set('Content-Range', `bytes ${start}-${end}/${size}`)
              stream = archive.createReadStream(finalPath, {
                start,
                end
              })
            } else {
              responseHeaders.set('Content-Length', `${size}`)
              stream = archive.createReadStream(finalPath)
            }
          } else {
            stream = archive.createReadStream(finalPath)
          }
        }

        if (method === 'HEAD') {
          stream.destroy()
          return new FakeResponse(204, 'ok', responseHeaders, intoStream(''), url)
        } else {
          return new FakeResponse(statusCode, 'ok', responseHeaders, stream, url)
        }
      } else {
        return new FakeResponse(405, 'Method Not Allowed', responseHeaders, intoStream('Method Not Allowed'), url)
      }
    } catch (e) {
      const isUnauthorized = (e.message === NOT_WRITABLE_ERROR)
      const status = isUnauthorized ? 403 : 500
      const message = isUnauthorized ? 'Not Authorized' : 'Server Error'
      return new FakeResponse(status, message, responseHeaders, intoStream(e.stack), url)
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

class FakeResponse {
  constructor (status, statusText, headers, stream, url) {
    this.body = stream
    this.headers = headers
    this.url = url
    this.status = status
    this.statusText = statusText
  }

  get ok () {
    return this.status && this.status < 400
  }

  get useFinalURL () {
    return true
  }

  async arrayBuffer () {
    const buffer = await concatPromise(this.body)
    return buffer.buffer
  }

  async text () {
    const buffer = await concatPromise(this.body)
    return buffer.toString('utf-8')
  }

  async json () {
    return JSON.parse(await this.text())
  }
}

function concatPromise (stream) {
  return new Promise((resolve, reject) => {
    var concatStream = concat(resolve)
    concatStream.once('error', reject)
    stream.pipe(concatStream)
  })
}

function intoStream (data) {
  return new Readable({
    read () {
      this.push(data)
      this.push(null)
    }
  })
}

function getMimeType (path) {
  let mimeType = mime.getType(path) || 'text/plain'
  if (mimeType.startsWith('text/')) mimeType = `${mimeType}; charset=utf-8`
  return mimeType
}
