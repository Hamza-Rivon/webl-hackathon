/**
 * Jobs Store
 *
 * Zustand store for tracking background job progress.
 */

import { create } from 'zustand';

export interface Job {
  id: string;
  type: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  stage?: string;
  estimatedTimeRemaining?: number;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface JobStore {
  activeJobs: Job[];
  addJob: (job: Job) => void;
  updateJob: (id: string, updates: Partial<Job>) => void;
  removeJob: (id: string) => void;
  clearCompletedJobs: () => void;
  getJobById: (id: string) => Job | undefined;
}

export const useJobStore = create<JobStore>((set, get) => ({
  activeJobs: [],

  addJob: (job) =>
    set((state) => ({
      activeJobs: [...state.activeJobs, job],
    })),

  updateJob: (id, updates) =>
    set((state) => ({
      activeJobs: state.activeJobs.map((job) =>
        job.id === id ? { ...job, ...updates, updatedAt: new Date() } : job
      ),
    })),

  removeJob: (id) =>
    set((state) => ({
      activeJobs: state.activeJobs.filter((job) => job.id !== id),
    })),

  clearCompletedJobs: () =>
    set((state) => ({
      activeJobs: state.activeJobs.filter(
        (job) => job.status !== 'completed' && job.status !== 'failed'
      ),
    })),

  getJobById: (id) => get().activeJobs.find((job) => job.id === id),
}));
