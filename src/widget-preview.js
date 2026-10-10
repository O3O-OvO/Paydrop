import { defaults, validatePatch } from './settings.js';

// Preview never reads the user's store, subscribes to IPC or writes local storage.
export function createPreviewStore() {
  let data = { settings: { ...structuredClone(defaults), setupComplete: true }, records: [], archivedRecords: [], revision: 0 };
  const listeners = new Set();
  return {
    init: async () => data,
    get data() { return data; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async dispatch(operation) {
      if (operation.type !== 'settings') return data;
      data = { ...data, settings: validatePatch(data.settings, operation.patch) };
      for (const listener of listeners) listener(data);
      return data;
    },
  };
}
