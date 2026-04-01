/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ICronJob } from '@/common/adapter/ipcBridge';
import { useApi } from '@renderer/api';
import { emitter } from '@/renderer/utils/emitter';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Common cron job actions
 */
interface CronJobActionsResult {
  pauseJob: (jobId: string) => Promise<void>;
  resumeJob: (jobId: string) => Promise<void>;
  deleteJob: (jobId: string) => Promise<void>;
  updateJob: (jobId: string, updates: Partial<ICronJob>) => Promise<ICronJob>;
}

/**
 * Creates common cron job action handlers
 */
function useCronJobActions(
  onJobUpdated?: (jobId: string, job: ICronJob) => void,
  onJobDeleted?: (jobId: string) => void
): CronJobActionsResult {
  const api = useApi();
  const pauseJob = useCallback(
    async (jobId: string) => {
      const updated = await api.request('cron.update-job', { jobId, updates: { enabled: false } });
      onJobUpdated?.(jobId, updated);
    },
    [onJobUpdated]
  );

  const resumeJob = useCallback(
    async (jobId: string) => {
      const updated = await api.request('cron.update-job', { jobId, updates: { enabled: true } });
      onJobUpdated?.(jobId, updated);
    },
    [onJobUpdated]
  );

  const deleteJob = useCallback(
    async (jobId: string) => {
      await api.request('cron.remove-job', { jobId });
      onJobDeleted?.(jobId);
    },
    [onJobDeleted]
  );

  const updateJob = useCallback(
    async (jobId: string, updates: Partial<ICronJob>) => {
      const updated = await api.request('cron.update-job', { jobId, updates });
      onJobUpdated?.(jobId, updated);
      return updated;
    },
    [onJobUpdated]
  );

  return { pauseJob, resumeJob, deleteJob, updateJob };
}

/**
 * Event handlers for cron job subscription
 */
interface CronJobEventHandlers {
  onJobCreated: (job: ICronJob) => void;
  onJobUpdated: (job: ICronJob) => void;
  onJobRemoved: (data: { jobId: string }) => void;
}

/**
 * Subscribe to cron job events with unified cleanup
 */
function useCronJobSubscription(handlers: CronJobEventHandlers) {
  const api = useApi();
  useEffect(() => {
    const unsubCreate = api.on('cron.job-created', handlers.onJobCreated);
    const unsubUpdate = api.on('cron.job-updated', handlers.onJobUpdated);
    const unsubRemove = api.on('cron.job-removed', handlers.onJobRemoved);

    return () => {
      unsubCreate();
      unsubUpdate();
      unsubRemove();
    };
  }, [handlers.onJobCreated, handlers.onJobUpdated, handlers.onJobRemoved]);
}

/**
 * Hook for managing cron jobs for a specific conversation
 * @param conversationId - The conversation ID to fetch jobs for
 */
export function useCronJobs(conversationId?: string) {
  const api = useApi();
  const [jobs, setJobs] = useState<ICronJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Fetch jobs for the conversation
  const fetchJobs = useCallback(async () => {
    if (!conversationId) {
      setJobs([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await api.request('cron.list-jobs-by-conversation', { conversationId });
      setJobs(result || []);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch cron jobs'));
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  // Initial fetch
  useEffect(() => {
    void fetchJobs();
  }, [fetchJobs]);

  // Event handlers
  const eventHandlers = useMemo<CronJobEventHandlers>(
    () => ({
      onJobCreated: (job: ICronJob) => {
        if (job.metadata.conversationId === conversationId) {
          setJobs((prev) => (prev.some((j) => j.id === job.id) ? prev : [...prev, job]));
        }
      },
      onJobUpdated: (job: ICronJob) => {
        if (job.metadata.conversationId === conversationId) {
          setJobs((prev) => prev.map((j) => (j.id === job.id ? job : j)));
        }
      },
      onJobRemoved: ({ jobId }: { jobId: string }) => {
        setJobs((prev) => prev.filter((j) => j.id !== jobId));
      },
    }),
    [conversationId]
  );

  useCronJobSubscription(eventHandlers);

  // Actions (without local state updates, rely on events)
  const actions = useCronJobActions();

  // Computed values
  const hasJobs = jobs.length > 0;
  const activeJobsCount = jobs.filter((j) => j.enabled).length;
  const hasError = jobs.some((j) => j.state.lastStatus === 'error');

  return {
    jobs,
    loading,
    error,
    hasJobs,
    activeJobsCount,
    hasError,
    refetch: fetchJobs,
    ...actions,
  };
}

/**
 * Hook for managing all cron jobs across all conversations
 */
export function useAllCronJobs() {
  const api = useApi();
  const [jobs, setJobs] = useState<ICronJob[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch all jobs
  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const allJobs = await api.request('cron.list-jobs', undefined);
      setJobs(allJobs || []);
    } catch (err) {
      console.error('[useAllCronJobs] Failed to fetch jobs:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    void fetchJobs();
  }, [fetchJobs]);

  // Event handlers
  const eventHandlers = useMemo<CronJobEventHandlers>(
    () => ({
      onJobCreated: (job: ICronJob) => {
        setJobs((prev) => (prev.some((j) => j.id === job.id) ? prev : [...prev, job]));
      },
      onJobUpdated: (job: ICronJob) => {
        setJobs((prev) => prev.map((j) => (j.id === job.id ? job : j)));
      },
      onJobRemoved: ({ jobId }: { jobId: string }) => {
        setJobs((prev) => prev.filter((j) => j.id !== jobId));
      },
    }),
    []
  );

  useCronJobSubscription(eventHandlers);

  // Actions with local state updates
  const handleJobUpdated = useCallback((jobId: string, job: ICronJob) => {
    setJobs((prev) => prev.map((j) => (j.id === jobId ? job : j)));
  }, []);

  const handleJobDeleted = useCallback((jobId: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
  }, []);

  const actions = useCronJobActions(handleJobUpdated, handleJobDeleted);

  // Computed values
  const activeCount = useMemo(() => jobs.filter((j) => j.enabled).length, [jobs]);
  const hasError = useMemo(() => jobs.some((j) => j.state.lastStatus === 'error'), [jobs]);

  return {
    jobs,
    loading,
    activeCount,
    hasError,
    refetch: fetchJobs,
    ...actions,
  };
}

/**
 * Hook for getting cron job status for all conversations
 * Used by ChatHistory to show indicators
 */
export function useCronJobsMap() {
  const api = useApi();
  const [jobsMap, setJobsMap] = useState<Map<string, ICronJob[]>>(new Map());
  const [loading, setLoading] = useState(true);
  // Track conversations with unread cron executions (red dot indicator)
  const [unreadConversations, setUnreadConversations] = useState<Set<string>>(() => {
    // Restore from localStorage
    try {
      const stored = localStorage.getItem('aionui_cron_unread');
      if (stored) {
        return new Set(JSON.parse(stored));
      }
    } catch {
      // ignore
    }
    return new Set();
  });
  // Track lastRunAtMs for each job to detect new executions
  const lastRunAtMapRef = useRef<Map<string, number>>(new Map());
  // Track current active conversation (use ref to access latest value in event handlers)
  const activeConversationIdRef = useRef<string | null>(null);

  // Persist unread state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('aionui_cron_unread', JSON.stringify([...unreadConversations]));
    } catch {
      // ignore
    }
  }, [unreadConversations]);

  // Fetch all jobs and group by conversation
  const fetchAllJobs = useCallback(async () => {
    setLoading(true);
    try {
      const allJobs = await api.request('cron.list-jobs', undefined);
      const map = new Map<string, ICronJob[]>();

      for (const job of allJobs || []) {
        const convId = job.metadata.conversationId;
        if (!map.has(convId)) {
          map.set(convId, []);
        }
        map.get(convId)!.push(job);
        // Initialize lastRunAtMap for detecting new executions
        if (job.state.lastRunAtMs) {
          lastRunAtMapRef.current.set(job.id, job.state.lastRunAtMs);
        }
      }

      setJobsMap(map);
    } catch (err) {
      console.error('[useCronJobsMap] Failed to fetch jobs:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    void fetchAllJobs();
  }, [fetchAllJobs]);

  // Event handlers
  const eventHandlers = useMemo<CronJobEventHandlers>(
    () => ({
      onJobCreated: (job: ICronJob) => {
        setJobsMap((prev) => {
          const convId = job.metadata.conversationId;
          const existing = prev.get(convId) || [];
          if (existing.some((j) => j.id === job.id)) {
            return prev;
          }
          const newMap = new Map(prev);
          newMap.set(convId, [...existing, job]);
          return newMap;
        });
        // Refresh conversation list to update sorting (modifyTime was updated)
        console.log('[useCronJobsMap] onJobCreated, triggering chat.history.refresh');
        emitter.emit('chat.history.refresh');
      },
      onJobUpdated: (job: ICronJob) => {
        const convId = job.metadata.conversationId;

        // Check if this is a new execution (lastRunAtMs changed)
        const prevLastRunAt = lastRunAtMapRef.current.get(job.id);
        const newLastRunAt = job.state.lastRunAtMs;
        if (newLastRunAt && newLastRunAt !== prevLastRunAt) {
          lastRunAtMapRef.current.set(job.id, newLastRunAt);

          // Mark as unread only if user is not currently viewing this conversation
          // Use ref to access the latest activeConversationId value
          if (activeConversationIdRef.current !== convId) {
            setUnreadConversations((prev) => {
              if (prev.has(convId)) return prev;
              const newSet = new Set(prev);
              newSet.add(convId);
              return newSet;
            });
          }

          // Refresh conversation list to update sorting (modifyTime was updated after execution)
          emitter.emit('chat.history.refresh');
        }

        setJobsMap((prev) => {
          const newMap = new Map(prev);
          const existing = newMap.get(convId) || [];
          newMap.set(
            convId,
            existing.map((j) => (j.id === job.id ? job : j))
          );
          return newMap;
        });
      },
      onJobRemoved: ({ jobId }: { jobId: string }) => {
        setJobsMap((prev) => {
          const newMap = new Map(prev);
          for (const [convId, convJobs] of newMap.entries()) {
            const filtered = convJobs.filter((j) => j.id !== jobId);
            if (filtered.length === 0) {
              newMap.delete(convId);
            } else if (filtered.length !== convJobs.length) {
              newMap.set(convId, filtered);
            }
          }
          return newMap;
        });
      },
    }),
    []
  );

  useEffect(() => {
    const unsubCreate = api.on('cron.job-created', eventHandlers.onJobCreated);
    const unsubUpdate = api.on('cron.job-updated', eventHandlers.onJobUpdated);
    const unsubRemove = api.on('cron.job-removed', eventHandlers.onJobRemoved);

    return () => {
      unsubCreate();
      unsubUpdate();
      unsubRemove();
    };
  }, [eventHandlers]);

  // Helper functions
  const hasJobsForConversation = useCallback(
    (conversationId: string) => {
      return jobsMap.has(conversationId) && jobsMap.get(conversationId)!.length > 0;
    },
    [jobsMap]
  );

  const getJobsForConversation = useCallback(
    (conversationId: string): ICronJob[] => {
      return jobsMap.get(conversationId) || [];
    },
    [jobsMap]
  );

  const getJobStatus = useCallback(
    (conversationId: string): 'none' | 'active' | 'paused' | 'error' | 'unread' => {
      const convJobs = jobsMap.get(conversationId);
      if (!convJobs || convJobs.length === 0) {
        return 'none';
      }

      // Check if conversation has unread cron executions (highest priority for visual indicator)
      if (unreadConversations.has(conversationId)) return 'unread';

      // Check if any job has error
      if (convJobs.some((j) => j.state.lastStatus === 'error')) return 'error';

      // Check if all jobs are paused
      if (convJobs.every((j) => !j.enabled)) return 'paused';

      return 'active';
    },
    [jobsMap, unreadConversations]
  );

  // Mark a conversation as read (clear unread status)
  const markAsRead = useCallback((conversationId: string) => {
    activeConversationIdRef.current = conversationId;
    setUnreadConversations((prev) => {
      if (!prev.has(conversationId)) {
        return prev;
      }
      const newSet = new Set(prev);
      newSet.delete(conversationId);
      return newSet;
    });
  }, []);

  // Update active conversation ref without triggering state update
  // Use this to sync the ref when route changes (e.g., URL navigation)
  const setActiveConversation = useCallback((conversationId: string) => {
    activeConversationIdRef.current = conversationId;
  }, []);

  // Check if a conversation has unread cron executions
  const hasUnread = useCallback(
    (conversationId: string) => {
      return unreadConversations.has(conversationId);
    },
    [unreadConversations]
  );

  return useMemo(
    () => ({
      jobsMap,
      loading,
      hasJobsForConversation,
      getJobsForConversation,
      getJobStatus,
      markAsRead,
      setActiveConversation,
      hasUnread,
      refetch: fetchAllJobs,
    }),
    [
      jobsMap,
      loading,
      hasJobsForConversation,
      getJobsForConversation,
      getJobStatus,
      markAsRead,
      setActiveConversation,
      hasUnread,
      fetchAllJobs,
    ]
  );
}

export default useCronJobs;
