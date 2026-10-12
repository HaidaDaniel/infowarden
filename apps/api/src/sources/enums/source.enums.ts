export enum SourceType {
  LOCAL_FOLDER = 'local_folder',
  GIT_REPO = 'git_repo',
  UPLOAD = 'upload',
  URL = 'url',
  OBSIDIAN_VAULT = 'obsidian_vault',
}

export enum SourceStatus {
  ACTIVE = 'active',
  SYNCING = 'syncing',
  FAILED = 'failed',
  DISABLED = 'disabled',
}
