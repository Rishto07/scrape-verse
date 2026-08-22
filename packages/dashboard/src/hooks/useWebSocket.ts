import { useEffect, useState, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { AppEvent, ConnectionStatus } from '../types/events';

export function useWebSocket() {
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    let active = true;
    const socket = io(undefined, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });
    socketRef.current = socket;

    socket.on('connect', () => setStatus('connected'));
    socket.on('disconnect', () => setStatus('disconnected'));
    socket.on('connect_error', () => setStatus('disconnected'));

    socket.on('event', (event: AppEvent) => {
      setEvents((prev) => [event, ...prev].slice(0, 500));
    });

    fetch('/api/heal-events?limit=100')
      .then((res) => res.ok ? res.json() : [])
      .then((events: AppEvent[]) => {
        if (active) setEvents(events);
      })
      .catch(() => undefined);

    return () => {
      active = false;
      socket.disconnect();
    };
  }, []);

  const triggerCollector = useCallback((collectorId: string, simulate = false) => {
    const query = simulate ? '?simulate=true' : '';
    return fetch(`/api/trigger/${encodeURIComponent(collectorId)}${query}`, {
      method: 'POST',
    });
  }, []);

  const primeCollectors = useCallback(() => {
    return fetch('/api/prime', { method: 'POST' });
  }, []);

  return { events, status, triggerCollector, primeCollectors };
}
