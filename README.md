# dat-fetch
Implementation of Fetch that uses the DatArchive API

`npm install --save dat-fetch`

```js
const makeFetch = require('dat-fetch')

const fetch = makeFetch(DatArchive, fetch)

const datproject = `dat://60c525b5589a5099aa3610a8ee550dcd454c3e118f7ac93b7d41b6b850272330`

const response = await fetch(`${datproject}/dat.json`)

const datjson = await response.json()

console.log(datjson)
```

Or if you're using the Dat SDK

```js
const makeFetch = require('dat-fetch/sdk')
const sdk = require('dat-sdk')()

const fetch = makeFetch(sdk, fetch)

const datproject = `dat://60c525b5589a5099aa3610a8ee550dcd454c3e118f7ac93b7d41b6b850272330`

const response = await fetch(`${datproject}/dat.json`)

const datjson = await response.json()

console.log(datjson)
```
