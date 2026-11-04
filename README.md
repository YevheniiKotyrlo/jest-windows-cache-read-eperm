# jest-windows-cache-read-eperm

On Windows, a worker's read of jest's transform cache that meets another worker's rename of the same file gets `EPERM`, and the suite that needed the module fails to run:

```
jest: failed to read cache file: …/jest-transform-cache-…/56/module540_…
Failure message: EPERM: operation not permitted, open '…\56\module540_…'
```

`repro.js` writes a project of one test file per worker, each requiring the same 1,000 small modules, and runs jest on it with an empty `--cacheDirectory` and a worker per CPU but one until a run loses a suite that way, printing the jest it ran and each run's outcome.

```sh
npm install
node repro.js                                            # jest from npm
node repro.js <jest checkout>/packages/jest/bin/jest.js  # jest built from source, such as main
```

A second argument caps the runs, 25 by default.
