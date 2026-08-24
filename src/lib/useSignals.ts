import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import type { Signal, SignalPage } from './types';

type Status = 'open' | 'closed' | 'all';

export function useSignals(status: Status, pageSize = 15) {
  const [items, setItems] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const pageRef = useRef(1);

  const fetchPage = useCallback(
    async (page: number, append: boolean) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await api<SignalPage>(
          `/signals?status=${status}&page=${page}&pageSize=${pageSize}`,
        );
        pageRef.current = page;
        setHasMore(res.hasMore);
        setTotal(res.total);
        setItems((current) => (append ? [...current, ...res.items] : res.items));
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message : 'Could not load signals. Please try again.';
        setError(message);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [status, pageSize],
  );

  useEffect(() => {
    void fetchPage(1, false);
  }, [fetchPage]);

  // Keep the live feed fresh without a full page reload.
  useEffect(() => {
    if (status !== 'open') return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void fetchPage(1, false);
    }, 30000);
    return () => window.clearInterval(timer);
  }, [status, fetchPage]);

  const loadMore = useCallback(() => {
    void fetchPage(pageRef.current + 1, true);
  }, [fetchPage]);

  const reload = useCallback(() => {
    void fetchPage(1, false);
  }, [fetchPage]);

  return { items, loading, loadingMore, error, hasMore, total, loadMore, reload };
}
