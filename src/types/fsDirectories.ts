export type FsDirectoryEntry = {
  name: string
  path: string
}

export type FsDirectoriesResponse = {
  path: string
  parentPath: string | null
  roots: string[]
  directories: FsDirectoryEntry[]
}

export type FsMkdirResponse = {
  path: string
}

export type FsEntryKind = 'file' | 'directory'

export type FsEntry = {
  name: string
  path: string
  kind: FsEntryKind
}

/** Directory listing for @ path completion (files + subfolders). */
export type FsCompleteResponse = {
  cwd: string
  query: string
  entries: FsEntry[]
}
