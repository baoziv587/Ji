// The shared package build (../../tsdown.config.ts), plus the server: nothing imports it, the client starts it by its
// path (src/client/launch.ts), so it is built as an entry of its own and kept out of the exports.

import { packageBuild } from '../../tsdown.config.ts'

export default packageBuild(import.meta.dirname, ['./src/server.ts'])
