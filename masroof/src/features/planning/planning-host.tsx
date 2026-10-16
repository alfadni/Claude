import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useBootStore } from '../boot/boot-store';
import { registerPlanningTask } from './background-task';

/**
 * Re-runs the recurrence engine when the app returns to the foreground on a
 * new day (ADR-013), and registers the background task once.
 */
export function PlanningHost() {
  const runPlanning = useBootStore((s) => s.runPlanning);
  const registered = useRef(false);

  useEffect(() => {
    if (!registered.current) {
      registered.current = true;
      void registerPlanningTask();
    }
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      const s = useBootStore.getState();
      if (s.status !== 'ready') return;
      if (s.planning.lastRunOn !== s.services.repos.today()) void runPlanning();
    });
    return () => sub.remove();
  }, [runPlanning]);

  return null;
}
