const resolveDatPath = require('resolve-dat-path/promise')
const Headers = require('fetch-headers')
const mime = require('mime/lite')
const concat = require('concat-stream')
const intoStream = require('into-stream')

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

    let resolved = null

    try {
      resolved = await resolveDatPath(archive, path)
      path = resolved.path
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

    let buffer = null

    if (resolved.type === 'file') {
      const rawBuffer = await archive.readFile(path, {
        encoding: 'binary'
      })

      buffer = Buffer.from(rawBuffer)
    } else {
      const files = await archive.readdir()

      const page = `
        <title>${url}</title>
        <h1>Index of ${url}</h1>
        <ul>
          <li><a href="../">../</a></li>${files.map((file) => `
          <li><a href="${file}">${file}</a></li>
        `).join('')}</ul>
      `

      buffer = Buffer.from(page)
    }

    const stream = intoStream(buffer)

    const contentType = mime.getType(path) || 'text/plain'

    const headers = new Headers([
      ['content-type', contentType]
    ])

    return new FakeResponse(200, 'ok', headers, stream, url)
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
