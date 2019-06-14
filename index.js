const DAT_REGEX = /dat:\/\/([^/]+)\/?([^#?]*)?/i

const resolveDatPath = require('resolve-dat-path/promise')

module.exports = function makeFetch (DatArchive, fetch, sourceDomain) {
  const isSourceDat = sourceDomain && sourceDomain.startsWith('dat://')

  return async function (url) {
    if (typeof url !== 'string') return fetch.apply(this, arguments)

    const isDatURL = url.startsWith('dat://')
    const urlHasProtocol = url.match(/^\w+:\/\//)

    const shouldIntercept = isDatURL || (!urlHasProtocol && isSourceDat)

    if (!shouldIntercept) return fetch.apply(this, arguments)

    let { path } = parseDatURL(url)
    const archive = new DatArchive(url)

    try {
      const resolved = await resolveDatPath(archive, path)
      path = resolved.path
    } catch(e) {
      return new FakeResponse(404, 'Not Found', Buffer.from([]), url)
    }

    const rawBuffer = await archive.readFile(path, {
      encoding: 'binary'
    })

    const buffer = Buffer.from(rawBuffer)

    return new FakeResponse(buffer, url)
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
  constructor (status, statusText, buffer, url) {
    this.body = new FakeBody(buffer)
    this.url = url
    this.status = status
    this.statusText = statusText
  }
  get headers () {
    return {}
  }
  get ok () {
    return this.status && this.status < 400
  }
  get useFinalURL () {
    return true
  }
}

class FakeBody {
  constructor (buffer) {
    this._buffer = buffer
  }
  async arrayBuffer () {
    return this._buffer.buffer
  }
  async text () {
    return this.buffer.toString('utf-8')
  }
  async json () {
    return JSON.parse(await this.text())
  }
}
