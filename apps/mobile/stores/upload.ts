/**
 * Upload Store
 *
 * Zustand store for tracking file upload progress.
 */

import { create } from 'zustand';

export interface UploadProgress {
  id: string;
  fileName: string;
  fileSize: number;
  progress: number;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  error?: string;
}

interface UploadStore {
  uploads: Map<string, UploadProgress>;
  addUpload: (id: string, fileName: string, fileSize: number) => void;
  updateProgress: (id: string, progress: number) => void;
  setStatus: (id: string, status: UploadProgress['status'], error?: string) => void;
  removeUpload: (id: string) => void;
  clearCompleted: () => void;
}

export const useUploadStore = create<UploadStore>((set) => ({
  uploads: new Map(),

  addUpload: (id, fileName, fileSize) =>
    set((state) => {
      const newUploads = new Map(state.uploads);
      newUploads.set(id, {
        id,
        fileName,
        fileSize,
        progress: 0,
        status: 'pending',
      });
      return { uploads: newUploads };
    }),

  updateProgress: (id, progress) =>
    set((state) => {
      const upload = state.uploads.get(id);
      if (!upload) return state;

      const newUploads = new Map(state.uploads);
      newUploads.set(id, {
        ...upload,
        progress,
        status: progress < 100 ? 'uploading' : 'completed',
      });
      return { uploads: newUploads };
    }),

  setStatus: (id, status, error) =>
    set((state) => {
      const upload = state.uploads.get(id);
      if (!upload) return state;

      const newUploads = new Map(state.uploads);
      newUploads.set(id, { ...upload, status, error });
      return { uploads: newUploads };
    }),

  removeUpload: (id) =>
    set((state) => {
      const newUploads = new Map(state.uploads);
      newUploads.delete(id);
      return { uploads: newUploads };
    }),

  clearCompleted: () =>
    set((state) => {
      const newUploads = new Map(state.uploads);
      for (const [id, upload] of newUploads) {
        if (upload.status === 'completed') {
          newUploads.delete(id);
        }
      }
      return { uploads: newUploads };
    }),
}));
