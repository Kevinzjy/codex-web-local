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
