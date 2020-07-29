const resolveDatPath = require('resolve-dat-path')
const Headers = require('fetch-headers')
const mime = require('mime/lite')
const concat = require('concat-stream')
const SDK = require('dat-sdk')
const { Readable } = require('stream')
const parseRange = require('range-parser')
const bodyToStream = require('fetch-request-body-to-stream')
const pump = require('pump-promise')

const DAT_REGEX = /\w+:\/\/([^/]+)\/?([^#?]*)?/

module.exports = function makeFetch (opts = {}) {
  let { Hyperdrive, resolveName, base, session, writable = true } = opts

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
    if (!writable) throw new Error('Writing to archives disabled')
    if (!archive.writable) {
      throw new Error('Archive not writable')
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
    try {
      let { path, key } = parseDatURL(url)
      if (!path) path = '/'

      const resolve = await getResolve()

      try {
        key = await resolve(`dat://${key}`)
      } catch (e) {
        // Probably a domain that couldn't resolve
        if (key.includes('.')) throw e
      }
      const Hyperdrive = await getHyperdrive()

      const archive = Hyperdrive(key)

      await archive.ready()

      if (method === 'PUT') {
        checkWritable(archive)
        const { body } = opts
        const source = bodyToStream(body, session)
        const destination = archive.createWriteStream(path)

        await pump(source, destination)

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
        let resolved = null
        let finalPath = path

        if (finalPath === 'index.json') {
          const resolvedURL = `hyper://${archive.key.toString('hex')}`
          const { writable } = archive
          let content = { url: resolvedURL, writable }
          try {
            const string = await archive.readFile(finalPath, 'utf8')
            const parsed = JSON.parse(string)
            content = { parsed, ...content }
          } catch (e) {
            // Probably a parsing error or something
          }

          const stringified = JSON.stringify(content, null, '\t')

          responseHeaders.set('Content-Type', 'application/json')

          return new FakeResponse(200, 'OK', responseHeaders, intoStream(stringified), url)
        }
        try {
          resolved = await resolveDatPathAwait(archive, path)
          finalPath = resolved.path
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

        responseHeaders.set('Content-Type', mime.getType(finalPath) || 'text/plain')

        let stream = null
        const isRanged = headers.get('Range') || headers.get('range')
        let statusCode = 200

        if (resolved.type === 'directory') {
          const files = await archive.readdir(finalPath)
          if (headers.get('Accept') === 'application/json') {
            const json = JSON.stringify(files, null, '\t')
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
            responseHeaders.set('Content-Type', 'text/html')
            const buffer = Buffer.from(page)
            stream = intoStream(buffer)
          }
        } else {
          responseHeaders.set('Accept-Ranges', 'bytes')
          if (isRanged) {
            const { stat } = resolved
            const { size } = stat
            const range = parseRange(size, isRanged)[0]
            if (range && range.type === 'bytes') {
              statusCode = 206
              const { start, end } = range
              const length = (end - start + 1)
              headers.set('Content-Length', `${length}`)
              headers.set('Content-Range', `bytes${start}-${end}/${size}`)
              stream = archive.createReadStream(finalPath, {
                start,
                end
              })
            } else {
              headers.set('Content-Length', `${size}`)
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
      return new FakeResponse(500, 'server error', responseHeaders, intoStream(e.stack), url)
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
