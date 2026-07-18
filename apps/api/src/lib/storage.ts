import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const storageRoot = join(process.cwd(), 'storage');
mkdirSync(storageRoot, { recursive: true });

export const ensureStorageDir = (relativePath: string) => {
  const fullPath = join(storageRoot, relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  return fullPath;
};

export const getPublicFileUrl = (relativePath: string) => `/files/${relativePath.replace(/\\/g, '/')}`;
export const storagePaths = { root: storageRoot } as const;
