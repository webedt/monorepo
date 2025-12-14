/**
 * Leaderboards API
 * Implements SPEC.md Section 4.5: Cloud Services - Leaderboards API foundation
 *
 * Provides the API structure for leaderboard functionality including:
 * - Fetching leaderboard entries
 * - Submitting scores
 * - Leaderboard configuration management
 */

import type {
  LeaderboardEntry,
  LeaderboardConfig,
  LeaderboardQueryOptions,
  LeaderboardResponse,
  LeaderboardResetPeriod,
} from '@/types/cloudServices';

// Storage key for local leaderboard data (for development/demo purposes)
const LEADERBOARDS_STORAGE_KEY = 'leaderboards-data';
const LEADERBOARD_CONFIGS_KEY = 'leaderboard-configs';

/**
 * Mock API response delay for development
 */
const simulateNetworkDelay = () => new Promise((resolve) => setTimeout(resolve, 200));

/**
 * Generate a unique ID
 */
const generateId = () => `lb-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

/**
 * Load leaderboard data from localStorage
 */
function loadLeaderboardData(): Record<string, LeaderboardEntry[]> {
  try {
    const stored = localStorage.getItem(LEADERBOARDS_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('[LeaderboardsAPI] Failed to load data:', e);
  }
  return {};
}

/**
 * Save leaderboard data to localStorage
 */
function saveLeaderboardData(data: Record<string, LeaderboardEntry[]>): void {
  try {
    localStorage.setItem(LEADERBOARDS_STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('[LeaderboardsAPI] Failed to save data:', e);
  }
}

/**
 * Load leaderboard configs from localStorage
 */
function loadLeaderboardConfigs(): Record<string, LeaderboardConfig> {
  try {
    const stored = localStorage.getItem(LEADERBOARD_CONFIGS_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('[LeaderboardsAPI] Failed to load configs:', e);
  }
  return {};
}

/**
 * Save leaderboard configs to localStorage
 */
function saveLeaderboardConfigs(configs: Record<string, LeaderboardConfig>): void {
  try {
    localStorage.setItem(LEADERBOARD_CONFIGS_KEY, JSON.stringify(configs));
  } catch (e) {
    console.error('[LeaderboardsAPI] Failed to save configs:', e);
  }
}

/**
 * Leaderboards API - Main interface for leaderboard operations
 */
export const leaderboardsApi = {
  /**
   * Get all leaderboards for a library item
   */
  async getLeaderboards(itemId: number): Promise<LeaderboardConfig[]> {
    await simulateNetworkDelay();

    const configs = loadLeaderboardConfigs();
    return Object.values(configs).filter((config) => config.itemId === itemId);
  },

  /**
   * Get a specific leaderboard configuration
   */
  async getLeaderboard(leaderboardId: string): Promise<LeaderboardConfig | null> {
    await simulateNetworkDelay();

    const configs = loadLeaderboardConfigs();
    return configs[leaderboardId] || null;
  },

  /**
   * Create a new leaderboard for an item
   */
  async createLeaderboard(
    itemId: number,
    config: Omit<LeaderboardConfig, 'id' | 'itemId' | 'createdAt' | 'isActive'>
  ): Promise<LeaderboardConfig> {
    await simulateNetworkDelay();

    const configs = loadLeaderboardConfigs();
    const newConfig: LeaderboardConfig = {
      ...config,
      id: generateId(),
      itemId,
      createdAt: new Date().toISOString(),
      isActive: true,
    };

    configs[newConfig.id] = newConfig;
    saveLeaderboardConfigs(configs);

    // Initialize empty leaderboard entries
    const data = loadLeaderboardData();
    data[newConfig.id] = [];
    saveLeaderboardData(data);

    return newConfig;
  },

  /**
   * Update leaderboard configuration
   */
  async updateLeaderboard(
    leaderboardId: string,
    updates: Partial<Omit<LeaderboardConfig, 'id' | 'itemId' | 'createdAt'>>
  ): Promise<LeaderboardConfig | null> {
    await simulateNetworkDelay();

    const configs = loadLeaderboardConfigs();
    const existing = configs[leaderboardId];

    if (!existing) {
      return null;
    }

    const updated: LeaderboardConfig = {
      ...existing,
      ...updates,
    };

    configs[leaderboardId] = updated;
    saveLeaderboardConfigs(configs);

    return updated;
  },

  /**
   * Delete a leaderboard
   */
  async deleteLeaderboard(leaderboardId: string): Promise<boolean> {
    await simulateNetworkDelay();

    const configs = loadLeaderboardConfigs();
    if (!configs[leaderboardId]) {
      return false;
    }

    delete configs[leaderboardId];
    saveLeaderboardConfigs(configs);

    // Also delete entries
    const data = loadLeaderboardData();
    delete data[leaderboardId];
    saveLeaderboardData(data);

    return true;
  },

  /**
   * Get leaderboard entries
   */
  async getEntries(
    leaderboardId: string,
    options: LeaderboardQueryOptions = {}
  ): Promise<LeaderboardResponse> {
    await simulateNetworkDelay();

    const {
      limit = 100,
      offset = 0,
      includeUser = false,
    } = options;

    const configs = loadLeaderboardConfigs();
    const config = configs[leaderboardId];
    const data = loadLeaderboardData();
    const allEntries = data[leaderboardId] || [];

    // Sort entries based on leaderboard type
    let sortedEntries = [...allEntries];
    if (config) {
      sortedEntries.sort((a, b) => {
        if (config.scoreType === 'lowest') {
          return a.score - b.score;
        }
        return b.score - a.score; // highest or cumulative
      });
    }

    // Assign ranks
    sortedEntries = sortedEntries.map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));

    // Paginate
    const paginatedEntries = sortedEntries.slice(offset, offset + limit);

    // Find user's entry if requested
    let userEntry: LeaderboardEntry | undefined;
    let userRank: number | undefined;
    if (includeUser) {
      const userId = 'current-user'; // In production, get from auth
      const userIndex = sortedEntries.findIndex((e) => e.userId === userId);
      if (userIndex >= 0) {
        userEntry = sortedEntries[userIndex];
        userRank = userIndex + 1;
      }
    }

    return {
      leaderboardId,
      entries: paginatedEntries,
      totalEntries: allEntries.length,
      userEntry,
      userRank,
      lastUpdated: new Date().toISOString(),
    };
  },

  /**
   * Submit a score to a leaderboard
   */
  async submitScore(
    leaderboardId: string,
    score: number,
    metadata?: Record<string, unknown>
  ): Promise<{ success: boolean; entry?: LeaderboardEntry; rank?: number; error?: string }> {
    await simulateNetworkDelay();

    const configs = loadLeaderboardConfigs();
    const config = configs[leaderboardId];

    if (!config) {
      return { success: false, error: 'Leaderboard not found' };
    }

    if (!config.isActive) {
      return { success: false, error: 'Leaderboard is not active' };
    }

    const data = loadLeaderboardData();
    const entries = data[leaderboardId] || [];

    const userId = 'current-user'; // In production, get from auth
    const existingIndex = entries.findIndex((e) => e.userId === userId);

    const now = new Date().toISOString();
    const newEntry: LeaderboardEntry = {
      id: existingIndex >= 0 ? entries[existingIndex].id : generateId(),
      userId,
      displayName: 'Current User', // In production, get from user profile
      score,
      rank: 0, // Will be calculated below
      metadata,
      achievedAt: now,
      verified: true,
    };

    // Check if we should update based on score type
    if (existingIndex >= 0) {
      const existingScore = entries[existingIndex].score;
      let shouldUpdate = false;

      switch (config.scoreType) {
        case 'highest':
          shouldUpdate = score > existingScore;
          break;
        case 'lowest':
          shouldUpdate = score < existingScore;
          break;
        case 'cumulative':
          newEntry.score = existingScore + score;
          shouldUpdate = true;
          break;
      }

      if (!shouldUpdate && config.scoreType !== 'cumulative') {
        return {
          success: true,
          entry: entries[existingIndex],
          rank: entries.findIndex((e, i) => {
            const sorted = [...entries].sort((a, b) =>
              config.scoreType === 'lowest' ? a.score - b.score : b.score - a.score
            );
            return sorted[i]?.userId === userId;
          }) + 1,
        };
      }

      entries[existingIndex] = newEntry;
    } else {
      entries.push(newEntry);
    }

    // Sort and calculate rank
    entries.sort((a, b) =>
      config.scoreType === 'lowest' ? a.score - b.score : b.score - a.score
    );

    const rank = entries.findIndex((e) => e.userId === userId) + 1;
    entries[rank - 1].rank = rank;

    data[leaderboardId] = entries;
    saveLeaderboardData(data);

    return { success: true, entry: entries[rank - 1], rank };
  },

  /**
   * Get user's entries across all leaderboards for an item
   */
  async getUserEntries(itemId: number): Promise<Array<{ leaderboard: LeaderboardConfig; entry: LeaderboardEntry }>> {
    await simulateNetworkDelay();

    const configs = loadLeaderboardConfigs();
    const data = loadLeaderboardData();
    const userId = 'current-user'; // In production, get from auth

    const results: Array<{ leaderboard: LeaderboardConfig; entry: LeaderboardEntry }> = [];

    Object.values(configs)
      .filter((config) => config.itemId === itemId)
      .forEach((config) => {
        const entries = data[config.id] || [];
        const userEntry = entries.find((e) => e.userId === userId);
        if (userEntry) {
          results.push({ leaderboard: config, entry: userEntry });
        }
      });

    return results;
  },

  /**
   * Reset a leaderboard (admin operation)
   */
  async resetLeaderboard(leaderboardId: string): Promise<boolean> {
    await simulateNetworkDelay();

    const data = loadLeaderboardData();
    if (!data[leaderboardId]) {
      return false;
    }

    data[leaderboardId] = [];
    saveLeaderboardData(data);

    return true;
  },
};

/**
 * Check if an item has leaderboards
 */
export async function hasLeaderboards(itemId: number): Promise<boolean> {
  const leaderboards = await leaderboardsApi.getLeaderboards(itemId);
  return leaderboards.length > 0;
}

/**
 * Format a score for display based on format type
 */
export function formatScore(score: number, format?: string): string {
  switch (format) {
    case 'time':
      // Format as MM:SS.mmm
      const minutes = Math.floor(score / 60000);
      const seconds = Math.floor((score % 60000) / 1000);
      const ms = score % 1000;
      return `${minutes}:${seconds.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;

    case 'distance':
      // Format with km/m
      if (score >= 1000) {
        return `${(score / 1000).toFixed(2)} km`;
      }
      return `${score.toFixed(1)} m`;

    case 'percentage':
      return `${score.toFixed(1)}%`;

    case 'currency':
      return `$${score.toLocaleString()}`;

    case 'points':
    default:
      return score.toLocaleString();
  }
}

/**
 * Get period label for display
 */
export function getPeriodLabel(period: LeaderboardResetPeriod): string {
  const labels: Record<LeaderboardResetPeriod, string> = {
    never: 'All-Time',
    daily: 'Today',
    weekly: 'This Week',
    monthly: 'This Month',
    seasonal: 'This Season',
  };
  return labels[period] || period;
}
