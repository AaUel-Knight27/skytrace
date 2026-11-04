/**
 * ======================================================================================
 * SkyTrace / SPHEREx Scope 3D — Background Live-Sync Layer & Shared Task Scheduler
 * ======================================================================================
 *
 * NASA / JPL Horizons & IRSA Server Polling Rationale & Defense:
 *
 * 1. SPHEREX_POLL_INTERVAL_MS (Default: 3 Minutes)
 *    Real-world SPHEREx Quick Release (QR) and public pipeline releases occur on episodic
 *    survey schedules, not sub-second streams. A 3-minute poll interval ensures that long-open
 *    browser tabs detect newly processed observation passes promptly during user sessions
 *    without generating excessive traffic against NASA/IPAC Infrared Science Archive (IRSA)
 *    SIA/TAP endpoints. Furthermore, checks are strictly metadata-only (querying MEF headers
 *    and coverage rather than re-downloading image cutouts).
 *
 * 2. EPHEMERIS_POLL_INTERVAL_MS (Default: 20 Minutes)
 *    JPL Horizons state vectors for Solar System bodies span 2-year windows (2025–2027) with
 *    5-day Hermite interpolation steps. Within any 20-minute window, planetary orbital drift
 *    relative to the interpolated polynomial is on the order of millimeters — visually
 *    undetectable at solar system scales. A 20-minute cadence gently advances the vector window
 *    to guarantee long-running tabs never fall behind true real-time, while respecting JPL's
 *    ssd.jpl.nasa.gov rate expectations. Polls are strictly scoped to currently relevant bodies
 *    (the focused target + Earth origin) and staggered across ticks.
 *
 * 3. Page Visibility API (Zero Idle Hammering)
 *    All registered polling tasks automatically freeze when the browser tab is hidden
 *    (`document.hidden === true`). The moment the user returns to the tab, the scheduler
 *    immediately fires all tasks once for instantaneous real-time responsiveness, avoiding
 *    wasted network overhead and CPU cycles while backgrounded.
 *
 * 4. Concurrency Guard & Exponential Backoff
 *    Tasks maintain per-task in-flight locks and AbortControllers, preventing overlapping
 *    requests if an endpoint responds slowly. Failed network calls trigger exponential backoff
 *    (doubling the retry interval up to MAX_BACKOFF_MS) and automatically reset to baseline
 *    upon the next successful response.
 * ======================================================================================
 */

// Tunable interval constants (exported for transparent configuration & testing)
export const SPHEREX_POLL_INTERVAL_MS = 3 * 60 * 1000;   // 3 minutes
export const EPHEMERIS_POLL_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes
export const MAX_BACKOFF_MS = 15 * 60 * 1000;             // 15 minutes max backoff cap
export const MIN_STAGGER_DELAY_MS = 2500;                 // 2.5s stagger between multi-body calls

class LiveSyncScheduler {
  constructor() {
    this.tasks = new Map();
    this.subscribers = new Set();
    this.isPaused = typeof document !== 'undefined' ? document.hidden : false;
    this.isInitialized = false;
    this.lastGlobalSyncTimestamp = null;

    this._handleVisibilityChange = this._handleVisibilityChange.bind(this);
  }

  /**
   * Initialize browser event listeners (Page Visibility API).
   */
  init() {
    if (typeof window === 'undefined' || this.isInitialized) return;
    this.isInitialized = true;
    this.isPaused = typeof document !== 'undefined' ? document.hidden : false;
    document.addEventListener('visibilitychange', this._handleVisibilityChange);
  }

  /**
   * Teardown scheduler, abort all in-flight requests, and clear all timers.
   */
  teardown() {
    if (typeof window !== 'undefined') {
      document.removeEventListener('visibilitychange', this._handleVisibilityChange);
    }
    this.isInitialized = false;

    // Clear and abort all tasks
    for (const [id, task] of this.tasks.entries()) {
      if (task.timerId) clearTimeout(task.timerId);
      if (task.abortController) {
        task.abortController.abort();
      }
    }
    this.tasks.clear();
    this.subscribers.clear();
  }

  /**
   * Handle tab visibility changes via the Page Visibility API.
   */
  _handleVisibilityChange() {
    if (typeof document === 'undefined') return;

    if (document.hidden) {
      // Tab backgrounded: pause all timers to conserve network & battery
      this.isPaused = true;
      for (const task of this.tasks.values()) {
        if (task.timerId) {
          clearTimeout(task.timerId);
          task.timerId = null;
        }
      }
      this._notify({ type: 'visibility_change', isHidden: true });
    } else {
      // Tab restored to focus: immediately fire every task once!
      this.isPaused = false;
      this._notify({ type: 'visibility_change', isHidden: false });

      for (const task of this.tasks.values()) {
        // Run immediately if not currently in flight
        if (!task.inFlight) {
          this._executeTask(task);
        } else {
          this._scheduleNext(task, task.intervalMs);
        }
      }
    }
  }

  /**
   * Register a background synchronization task.
   *
   * @param {Object} options
   * @param {string} options.id - Unique task identifier
   * @param {number} options.intervalMs - Base poll interval in milliseconds
   * @param {Function} options.run - Async function to execute: ({ signal }) => Promise<any>
   * @param {number} [options.backoffMs] - Optional custom initial backoff cap
   * @param {boolean} [options.immediate] - Whether to fire immediately upon registration (default: false)
   * @returns {Function} Unregister function
   */
  registerSyncTask({ id, intervalMs, run, backoffMs = MAX_BACKOFF_MS, immediate = false }) {
    // If a task with this ID already exists, cleanly unregister it first
    if (this.tasks.has(id)) {
      this.unregisterSyncTask(id);
    }

    const task = {
      id,
      baseIntervalMs: intervalMs,
      intervalMs,
      maxBackoffMs: backoffMs,
      run,
      inFlight: false,
      abortController: null,
      timerId: null,
      consecutiveFailures: 0,
      lastRunTimestamp: null,
      lastSuccessTimestamp: null
    };

    this.tasks.set(id, task);

    if (immediate && !this.isPaused) {
      this._executeTask(task);
    } else if (!this.isPaused) {
      this._scheduleNext(task, task.intervalMs);
    }

    return () => this.unregisterSyncTask(id);
  }

  /**
   * Unregister and abort a specific task.
   *
   * @param {string} id - Task identifier
   */
  unregisterSyncTask(id) {
    const task = this.tasks.get(id);
    if (!task) return;

    if (task.timerId) {
      clearTimeout(task.timerId);
      task.timerId = null;
    }

    if (task.abortController) {
      task.abortController.abort();
      task.abortController = null;
    }

    this.tasks.delete(id);
  }

  /**
   * Schedule the next execution tick for a task.
   */
  _scheduleNext(task, delayMs) {
    if (task.timerId) clearTimeout(task.timerId);
    // Crucial check: verify this exact task instance is still the active registered task
    if (this.isPaused || this.tasks.get(task.id) !== task) return;

    task.timerId = setTimeout(() => {
      task.timerId = null;
      this._executeTask(task);
    }, Math.max(100, delayMs));
  }

  /**
   * Execute task with concurrency guard and exponential backoff handling.
   */
  async _executeTask(task) {
    // Prevent overlapping runs or running a superseded/unregistered task instance
    if (task.inFlight || this.isPaused || this.tasks.get(task.id) !== task) return;

    if (task.timerId) {
      clearTimeout(task.timerId);
      task.timerId = null;
    }

    task.inFlight = true;
    task.abortController = new AbortController();
    task.lastRunTimestamp = Date.now();

    try {
      const result = await task.run({ signal: task.abortController.signal });

      // Guard: Check if task was unregistered or replaced while in-flight
      if (this.tasks.get(task.id) !== task) return;

      // Successful tick: reset backoff and update timestamps
      task.consecutiveFailures = 0;
      task.intervalMs = task.baseIntervalMs;
      task.lastSuccessTimestamp = Date.now();
      this.lastGlobalSyncTimestamp = task.lastSuccessTimestamp;

      this._notify({
        type: 'sync_success',
        taskId: task.id,
        timestamp: task.lastSuccessTimestamp,
        result
      });

      this._scheduleNext(task, task.intervalMs);
    } catch (err) {
      // AbortError indicates intentional cancellation (target switch or teardown)
      if (err?.name === 'AbortError') {
        if (this.tasks.get(task.id) === task && !this.isPaused) {
          this._scheduleNext(task, task.intervalMs);
        }
        return;
      }

      if (this.tasks.get(task.id) !== task) return;

      // Exponential backoff: double current interval up to maxBackoffMs
      task.consecutiveFailures++;
      const backedOffInterval = Math.min(
        task.maxBackoffMs,
        task.baseIntervalMs * Math.pow(2, task.consecutiveFailures)
      );
      task.intervalMs = backedOffInterval;

      this._notify({
        type: 'sync_error',
        taskId: task.id,
        error: err?.message || String(err),
        consecutiveFailures: task.consecutiveFailures,
        nextRetryMs: backedOffInterval
      });

      this._scheduleNext(task, backedOffInterval);
    } finally {
      task.inFlight = false;
      task.abortController = null;
    }
  }

  /**
   * Trigger an immediate run of a specific task by ID.
   */
  triggerTask(id) {
    const task = this.tasks.get(id);
    if (task && !task.inFlight) {
      if (task.timerId) clearTimeout(task.timerId);
      this._executeTask(task);
    }
  }

  /**
   * Broadcast a notification event to all registered subscribers.
   *
   * @param {Object} event
   */
  notify(event) {
    this._notify(event);
  }

  /**
   * Subscribe to scheduler sync events.
   *
   * @param {Function} listener
   * @returns {Function} Unsubscribe function
   */
  subscribe(listener) {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  _notify(event) {
    for (const listener of this.subscribers) {
      try {
        listener(event);
      } catch (e) {
        console.error('Error in liveSync subscriber:', e);
      }
    }
  }

  /**
   * Returns current scheduler state summary.
   */
  getStatus() {
    return {
      isPaused: this.isPaused,
      taskCount: this.tasks.size,
      lastGlobalSyncTimestamp: this.lastGlobalSyncTimestamp,
      tasks: Array.from(this.tasks.values()).map((t) => ({
        id: t.id,
        intervalMs: t.intervalMs,
        inFlight: t.inFlight,
        consecutiveFailures: t.consecutiveFailures,
        lastSuccessTimestamp: t.lastSuccessTimestamp
      }))
    };
  }
}

// Module-level plain singleton instance
export const liveSync = new LiveSyncScheduler();
