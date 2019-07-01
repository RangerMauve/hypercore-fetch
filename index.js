const resolveDatPath = require('resolve-dat-path/promise')
const Headers = require('fetch-headers')
const mime = require('mime/lite')

const DAT_REGEX = /dat:\/\/([^/]+)\/?([^#?]*)?/i

module.exports = function makeFetch (DatArchive, fetch, sourceDomain) {
  const isSourceDat = sourceDomain && sourceDomain.startsWith('dat://')

  return async function (url) {
    if (typeof url !== 'string') return fetch.apply(this, arguments)

    const isDatURL = url.startsWith('dat://')
    const urlHasProtocol = url.match(/^\w+:\/\//)

    const shouldIntercept = isDatURL || (!urlHasProtocol && isSourceDat)

    if (!shouldIntercept) return fetch.apply(this, arguments)

    let { path } = parseDatURL(url)
    if (!path) path = '/'
    const archive = new DatArchive(url)

    try {
      const resolved = await resolveDatPath(archive, path)
      path = resolved.path
    } catch (e) {
      return new FakeResponse(
        404,
        'Not Found',
        new Headers([
          'content-type', 'text/plain'
        ]),
        Buffer.from(e.stack),
        url)
    }

    const rawBuffer = await archive.readFile(path, {
      encoding: 'binary'
    })

    const buffer = Buffer.from(rawBuffer)

    const contentType = mime.getType(path) || 'text/plain'

    const headers = new Headers([
      ['content-type', contentType]
    ])

    return new FakeResponse(200, 'ok', headers, buffer, url)
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
  constructor (status, statusText, headers, buffer, url) {
    this._buffer = buffer
    this.body = new FakeBody(buffer)
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
    return this._buffer.buffer
  }
  async text () {
    return this._buffer.toString('utf-8')
  }
  async json () {
    return JSON.parse(await this.text())
  }
}

class FakeBody {
  constructor (buffer) {
    this._buffer = buffer
  }
}
