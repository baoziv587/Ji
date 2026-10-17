run pnpm lint once you finished all your changes

watch files and folders with chokidar, never fs.watch directly
write files atomically with write-file-atomic, never by hand (temp file + rename, hard links)
