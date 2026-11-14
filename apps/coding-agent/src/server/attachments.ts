// The files a client attaches to a message, read from the disk the server shares with it: each is named by its path,
// and a picture small enough goes to a model that takes images as one.

import type { Attachment } from '../agent/messages.ts'
import { readFile, stat } from 'node:fs/promises'
import { extname, isAbsolute } from 'node:path'

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

/** Providers refuse bigger pictures; the model still has the path, and the tools that read it. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/** Throws when a path is not absolute or not a file. */
export async function readAttachments(paths: readonly string[], images: boolean): Promise<Attachment[]> {
  return Promise.all(
    paths.map(async path => {
      if (!isAbsolute(path)) {
        throw new Error(`${path} is not an absolute path`)
      }
      const info = await stat(path).catch(() => undefined)
      if (info?.isFile() !== true) {
        throw new Error(`${path} is not a file`)
      }
      const mimeType = IMAGE_TYPES[extname(path).toLowerCase()]
      if (!images || mimeType === undefined || info.size > MAX_IMAGE_BYTES) {
        return { path }
      }
      return { path, image: { data: (await readFile(path)).toString('base64'), mimeType } }
    }),
  )
}
