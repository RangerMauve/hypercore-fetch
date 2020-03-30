# dat-fetch

Implementation of Fetch that uses the DatArchive API

`npm install --save dat-fetch`

**Warning** This uses the newest versin of Dat and doesn't work in the browser at the moment, nor does it have support for older version of Dat.
To support old versions, install version 1.3.x.

```javascript
const fetch = require('dat-fetch')()

const someURL = `dat://somethinghere.com`

const response = await fetch(`${someURL}/dat.json`)

const json = await response.json()

console.log(json)
```

You can also use the bundled CLI

```
npm i -g dat-fetch

dat-fetch dat://somethingorother

# Or

npx dat-fetch dat://somethingorother
```

## API

### `makeFetch({Hyperdrive, resolveName, fetch, base}) => fetch()`

Creates a dat-fetch instance.

The `base` parameter can be used to specify what the base URL is for relative paths like `fetch('./dat.json')`.

You can pass in options for the [Dat SDK](https://github.com/datproject/sdk) to have it be auto-created,
or you can pass in both a function matching  `const archive = Hyperdrive(key)` and a `const resolved = await resolveName(url)` function.

You can also pass in a custom `fetch` fallback for URLs that aren't using the `dat://` protocol, this will fall back to [universal-fetch](https://www.npmjs.com/package/universal-fetch).

Typically, you don't need to pass in any of these and they're there for more advanced users.

After you've created it, `fetch` will be have like it does in [browsers](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API).

### `await fetch.close()`

Closes resources for the Dat SDK. This does nothing if you specified the Hyperdrive and `resolveName` options.
