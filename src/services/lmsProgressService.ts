/**
 * LMS Progress Tracking Service
 * 
 * This module handles video progress tracking for Learning Management Systems.
 * Features:
 * - Resume playback from saved position
 * - Track watched percentage
 * - Milestone notifications (25%, 50%, 75%, 90%, 100%)
 * - Periodic progress saving
 * - Completion tracking
 */

import type {
  LMSProgressConfig,
  LMSProgressData,
  ProgressMilestone,
} from '../types';

// ============================================================================
// CONSTANTS
// ============================================================================

const MILESTONES: ProgressMilestone[] = [25, 50, 75, 90, 100];
const DEFAULT_SAVE_INTERVAL = 5000; // 5 seconds
const COMPLETION_THRESHOLD = 95; // Consider completed at 95%

// ============================================================================
// LMS PROGRESS MANAGER
// ============================================================================

/**
 * Manages LMS progress tracking for video playback
 */
export class LMSProgressManager {
  private config: LMSProgressConfig;
  private progressData: LMSProgressData;
  private saveTimer: ReturnType<typeof setInterval> | null = null;
  private isDestroyed = false;
  private hasEmittedFirstPlay = false;
  private reachedMilestones: Set<ProgressMilestone> = new Set();

  constructor(config: LMSProgressConfig) {
    this.config = config;
    
    // Initialize progress data from config or defaults
    this.progressData = {
      videoId: config.videoId,
      userId: config.userId,
      currentTime: config.initialProgress?.currentTime ?? 0,
      duration: config.initialProgress?.duration ?? 0,
      watchedPercentage: config.initialProgress?.watchedPercentage ?? 0,
      milestonesReached: config.initialProgress?.milestonesReached ?? [],
      hasStarted: config.initialProgress?.hasStarted ?? false,
      isCompleted: config.initialProgress?.isCompleted ?? false,
      lastUpdated: new Date().toISOString(),
    };

    // Restore reached milestones
    this.reachedMilestones = new Set(this.progressData.milestonesReached);
  }

  /**
   * Initialize progress tracking
   */
  initialize(duration: number): void {
    this.progressData.duration = duration;
    
    // Start auto-save timer
    const interval = this.config.saveInterval ?? DEFAULT_SAVE_INTERVAL;
    this.saveTimer = setInterval(() => {
      this.saveProgress();
    }, interval);
  }

  /**
   * Get resume position (for seeking on load)
   */
  getResumePosition(): number {
    if (this.progressData.isCompleted) {
      return 0; // Start from beginning if completed
    }
    return this.progressData.currentTime;
  }

  /**
   * Check if should resume playback
   */
  shouldResume(): boolean {
    return this.progressData.currentTime > 0 && !this.progressData.isCompleted;
  }

  /**
   * Handle first play event
   */
  handleFirstPlay(): void {
    if (!this.hasEmittedFirstPlay && !this.progressData.hasStarted) {
      this.hasEmittedFirstPlay = true;
      this.progressData.hasStarted = true;
      this.config.onFirstPlay?.(this.getProgress());
    }
  }

  /**
   * Update progress with current playback time
   */
  updateProgress(currentTime: number, duration: number): void {
    if (this.isDestroyed) return;

    this.progressData.currentTime = currentTime;
    this.progressData.duration = duration;
    
    // Calculate percentage
    const percentage = duration > 0 ? (currentTime / duration) * 100 : 0;
    this.progressData.watchedPercentage = Math.min(100, Math.round(percentage));
    this.progressData.lastUpdated = new Date().toISOString();

    // Check milestones
    this.checkMilestones();

    // Check completion
    if (percentage >= COMPLETION_THRESHOLD && !this.progressData.isCompleted) {
      this.handleCompletion();
    }
  }

  /**
   * Handle video completion
   */
  handleCompletion(): void {
    this.progressData.isCompleted = true;
    this.progressData.watchedPercentage = 100;
    
    // Ensure 100% milestone is reached
    if (!this.reachedMilestones.has(100)) {
      this.reachedMilestones.add(100);
      this.progressData.milestonesReached = Array.from(this.reachedMilestones);
      this.config.onMilestoneReached?.(100, this.getProgress());
    }

    this.config.onComplete?.(this.getProgress());
    this.saveProgress();
  }

  /**
   * Check and emit milestone events
   */
  private checkMilestones(): void {
    const percentage = this.progressData.watchedPercentage;
    const milestones = (this.config.milestones as ProgressMilestone[]) ?? MILESTONES;

    for (const milestone of milestones) {
      if (percentage >= milestone && !this.reachedMilestones.has(milestone)) {
        this.reachedMilestones.add(milestone);
        this.progressData.milestonesReached = Array.from(this.reachedMilestones);
        this.config.onMilestoneReached?.(milestone, this.getProgress());
      }
    }
  }

  /**
   * Save current progress
   */
  saveProgress(): void {
    if (this.isDestroyed || !this.config.onProgressSave) return;

    this.progressData.lastUpdated = new Date().toISOString();
    this.config.onProgressSave(this.getProgress());
  }

  /**
   * Get current progress data (immutable copy)
   */
  getProgress(): LMSProgressData {
    return { ...this.progressData };
  }

  /**
   * Reset progress (for rewatching)
   */
  reset(): void {
    this.progressData = {
      videoId: this.config.videoId,
      userId: this.config.userId,
      currentTime: 0,
      duration: this.progressData.duration,
      watchedPercentage: 0,
      milestonesReached: [],
      hasStarted: false,
      isCompleted: false,
      lastUpdated: new Date().toISOString(),
    };
    this.reachedMilestones.clear();
    this.hasEmittedFirstPlay = false;
  }

  /**
   * Destroy progress manager
   */
  destroy(): void {
    this.isDestroyed = true;
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
  }
}

// ============================================================================
// STORAGE HELPERS
// ============================================================================

const STORAGE_PREFIX = 'vidstream_video_progress_';

/**
 * Save progress to localStorage
 */
export function saveProgressToStorage(progress: LMSProgressData): void {
  try {
    const key = `${STORAGE_PREFIX}${progress.videoId}`;
    localStorage.setItem(key, JSON.stringify(progress));
  } catch (error) {
    console.warn('[VideoPlayer] Failed to save progress to localStorage:', error);
  }
}

/**
 * Load progress from localStorage
 */
export function loadProgressFromStorage(videoId: string): LMSProgressData | null {
  try {
    const key = `${STORAGE_PREFIX}${videoId}`;
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.warn('[VideoPlayer] Failed to load progress from localStorage:', error);
    return null;
  }
}

/**
 * Clear progress from localStorage
 */
export function clearProgressFromStorage(videoId: string): void {
  try {
    const key = `${STORAGE_PREFIX}${videoId}`;
    localStorage.removeItem(key);
  } catch (error) {
    console.warn('[VideoPlayer] Failed to clear progress from localStorage:', error);
  }
}

/**
 * Get all saved progress data
 */
export function getAllProgressFromStorage(): LMSProgressData[] {
  const results: LMSProgressData[] = [];
  
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) {
        const data = localStorage.getItem(key);
        if (data) {
          results.push(JSON.parse(data));
        }
      }
    }
  } catch (error) {
    console.warn('[VideoPlayer] Failed to get all progress from localStorage:', error);
  }

  return results;
}

// ============================================================================
// PROGRESS API ADAPTER
// ============================================================================

export interface ProgressAPIConfig {
  /** API endpoint for saving progress */
  saveEndpoint: string;
  /** API endpoint for loading progress */
  loadEndpoint: string;
  /** Authorization header */
  authToken?: string;
  /** Additional headers */
  headers?: Record<string, string>;
}

/**
 * Creates LMS progress callbacks that sync with a backend API
 */
export function createProgressAPICallbacks(apiConfig: ProgressAPIConfig) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...apiConfig.headers,
  };

  if (apiConfig.authToken) {
    headers['Authorization'] = `Bearer ${apiConfig.authToken}`;
  }

  return {
    onProgressSave: async (progress: LMSProgressData): Promise<void> => {
      try {
        await fetch(apiConfig.saveEndpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            video_id: progress.videoId,
            user_id: progress.userId,
            current_time: progress.currentTime,
            duration: progress.duration,
            watched_percentage: progress.watchedPercentage,
            milestones_reached: progress.milestonesReached,
            has_started: progress.hasStarted,
            is_completed: progress.isCompleted,
          }),
        });
      } catch (error) {
        console.error('[VideoPlayer] Failed to save progress to API:', error);
        // Fallback to localStorage
        saveProgressToStorage(progress);
      }
    },

    onMilestoneReached: async (milestone: ProgressMilestone, progress: LMSProgressData): Promise<void> => {
      try {
        await fetch(`${apiConfig.saveEndpoint}/milestone`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            video_id: progress.videoId,
            user_id: progress.userId,
            milestone,
            timestamp: new Date().toISOString(),
          }),
        });
      } catch (error) {
        console.error('[VideoPlayer] Failed to save milestone to API:', error);
      }
    },

    onComplete: async (progress: LMSProgressData): Promise<void> => {
      try {
        await fetch(`${apiConfig.saveEndpoint}/complete`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            video_id: progress.videoId,
            user_id: progress.userId,
            completed_at: new Date().toISOString(),
          }),
        });
      } catch (error) {
        console.error('[VideoPlayer] Failed to save completion to API:', error);
      }
    },

    loadProgress: async (videoId: string, userId?: string): Promise<Partial<LMSProgressData> | null> => {
      try {
        const params = new URLSearchParams({ video_id: videoId });
        if (userId) params.append('user_id', userId);

        const response = await fetch(`${apiConfig.loadEndpoint}?${params}`, {
          method: 'GET',
          headers,
        });

        if (!response.ok) {
          return loadProgressFromStorage(videoId);
        }

        const data = await response.json();
        return {
          currentTime: data.current_time,
          duration: data.duration,
          watchedPercentage: data.watched_percentage,
          milestonesReached: data.milestones_reached,
          hasStarted: data.has_started,
          isCompleted: data.is_completed,
        };
      } catch (error) {
        console.error('[VideoPlayer] Failed to load progress from API:', error);
        return loadProgressFromStorage(videoId);
      }
    },
  };
}
