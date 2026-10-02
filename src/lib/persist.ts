import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { PersistQueryClientProviderProps } from '@tanstack/react-query-persist-client';
import { del, get, set } from 'idb-keyval';

export const persister = createAsyncStoragePersister({
  storage: {
    getItem: (key: string) => get(key),
    setItem: (key: string, value: string) => set(key, value),
    removeItem: (key: string) => del(key)
  },
  key: 'taskgram-query-cache',
  throttleTime: 0
});

export const persistOptions: PersistQueryClientProviderProps['persistOptions'] = {
  persister,
  maxAge: 30 * 24 * 3600 * 1000,
  buster: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.1.0',
  dehydrateOptions: {
    shouldDehydrateQuery: (q) => ['tasks', 'projects', 'me', 'logbook'].includes(String(q.queryKey[0]))
  }
};
