export const STORAGE_PROFILE_VALUES = ['fast', 'balanced', 'low_memory', 'benchmark_remote'] as const;

export type StorageProfile = (typeof STORAGE_PROFILE_VALUES)[number];

export type QdrantCollectionOptions = {
  storageProfile: StorageProfile;
  onDiskVectors: boolean;
  onDiskPayload: boolean;
  onDiskHnsw: boolean;
  scalarQuantization: boolean;
};

export function normalizeStorageProfile(value?: string | null): StorageProfile {
  const normalized = String(value || '').trim();
  return STORAGE_PROFILE_VALUES.includes(normalized as StorageProfile)
    ? (normalized as StorageProfile)
    : 'balanced';
}

export function qdrantOptionsForStorageProfile(profile: StorageProfile): QdrantCollectionOptions {
  if (profile === 'fast') {
    return {
      storageProfile: profile,
      onDiskVectors: false,
      onDiskPayload: false,
      onDiskHnsw: false,
      scalarQuantization: false,
    };
  }

  if (profile === 'low_memory') {
    return {
      storageProfile: profile,
      onDiskVectors: true,
      onDiskPayload: true,
      onDiskHnsw: true,
      scalarQuantization: true,
    };
  }

  if (profile === 'benchmark_remote') {
    return {
      storageProfile: profile,
      onDiskVectors: true,
      onDiskPayload: true,
      onDiskHnsw: false,
      scalarQuantization: true,
    };
  }

  return {
    storageProfile: profile,
    onDiskVectors: true,
    onDiskPayload: true,
    onDiskHnsw: false,
    scalarQuantization: true,
  };
}
