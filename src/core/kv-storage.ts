/**
 * KV-based storage implementation for feature flags
 * Optimized for Cloudflare Workers KV
 */

import type {
  FlagStorage,
  FlagConfig,
  TenantOverride,
  CanaryConfig,
  UserSegment,
  FlagMetrics,
  FlagAuditLog
} from '../types';

export class KVFlagStorage implements FlagStorage {
  constructor(
    private kv: KVNamespace,
    private prefix: string = 'flags'
  ) {}

  // Flag management
  async getFlag(flagId: string): Promise<FlagConfig | null> {
    try {
      const key = `${this.prefix}:config:${flagId}`;
      const data = await this.kv.get(key, 'json');
      return data as FlagConfig | null;
    } catch (error) {
      console.error('Error getting flag from KV:', error);
      return null;
    }
  }

  async getAllFlags(): Promise<FlagConfig[]> {
    try {
      const listResult = await this.kv.list({ prefix: `${this.prefix}:config:` });
      const flags: FlagConfig[] = [];
      
      // KV list() is eventually consistent, so we may need to handle partial results
      for (const key of listResult.keys) {
        const flag = await this.kv.get(key.name, 'json') as FlagConfig;
        if (flag) {
          flags.push(flag);
        }
      }
      
      return flags;
    } catch (error) {
      console.error('Error getting all flags from KV:', error);
      return [];
    }
  }

  async saveFlag(flag: FlagConfig): Promise<void> {
    try {
      const key = `${this.prefix}:config:${flag.flagId}`;
      await this.kv.put(key, JSON.stringify(flag));
      
      // Update flag index for faster lookups
      await this.updateFlagIndex(flag.flagId, 'add');
    } catch (error) {
      console.error('Error saving flag to KV:', error);
      throw new Error(`Failed to save flag ${flag.flagId}: ${error}`);
    }
  }

  async deleteFlag(flagId: string): Promise<void> {
    try {
      const key = `${this.prefix}:config:${flagId}`;
      await this.kv.delete(key);
      
      // Clean up related data
      await Promise.all([
        this.deleteAllTenantOverrides(flagId),
        this.deleteCanaryConfig(flagId),
        this.deleteUserSegment(flagId),
        this.updateFlagIndex(flagId, 'remove')
      ]);
    } catch (error) {
      console.error('Error deleting flag from KV:', error);
      throw new Error(`Failed to delete flag ${flagId}: ${error}`);
    }
  }

  // Tenant overrides
  async getTenantOverride(tenantId: string, flagId: string): Promise<TenantOverride | null> {
    try {
      const key = `${this.prefix}:override:${tenantId}:${flagId}`;
      const data = await this.kv.get(key, 'json');
      return data as TenantOverride | null;
    } catch (error) {
      console.error('Error getting tenant override from KV:', error);
      return null;
    }
  }

  async saveTenantOverride(override: TenantOverride): Promise<void> {
    try {
      const key = `${this.prefix}:override:${override.tenantId}:${override.flagId}`;
      await this.kv.put(key, JSON.stringify(override));
    } catch (error) {
      console.error('Error saving tenant override to KV:', error);
      throw new Error(`Failed to save tenant override: ${error}`);
    }
  }

  async deleteTenantOverride(tenantId: string, flagId: string): Promise<void> {
    try {
      const key = `${this.prefix}:override:${tenantId}:${flagId}`;
      await this.kv.delete(key);
    } catch (error) {
      console.error('Error deleting tenant override from KV:', error);
      throw new Error(`Failed to delete tenant override: ${error}`);
    }
  }

  // Canary configurations
  async getCanaryConfig(flagId: string): Promise<CanaryConfig | null> {
    try {
      const key = `${this.prefix}:canary:${flagId}`;
      const data = await this.kv.get(key, 'json');
      return data as CanaryConfig | null;
    } catch (error) {
      console.error('Error getting canary config from KV:', error);
      return null;
    }
  }

  async saveCanaryConfig(flagId: string, config: CanaryConfig): Promise<void> {
    try {
      const key = `${this.prefix}:canary:${flagId}`;
      await this.kv.put(key, JSON.stringify(config));
    } catch (error) {
      console.error('Error saving canary config to KV:', error);
      throw new Error(`Failed to save canary config: ${error}`);
    }
  }

  async deleteCanaryConfig(flagId: string): Promise<void> {
    try {
      const key = `${this.prefix}:canary:${flagId}`;
      await this.kv.delete(key);
    } catch (error) {
      console.error('Error deleting canary config from KV:', error);
      throw new Error(`Failed to delete canary config: ${error}`);
    }
  }

  // User segments
  async getUserSegment(flagId: string): Promise<UserSegment | null> {
    try {
      const key = `${this.prefix}:segment:${flagId}`;
      const data = await this.kv.get(key, 'json');
      return data as UserSegment | null;
    } catch (error) {
      console.error('Error getting user segment from KV:', error);
      return null;
    }
  }

  async saveUserSegment(segment: UserSegment): Promise<void> {
    try {
      const key = `${this.prefix}:segment:${segment.flagId}`;
      await this.kv.put(key, JSON.stringify(segment));
    } catch (error) {
      console.error('Error saving user segment to KV:', error);
      throw new Error(`Failed to save user segment: ${error}`);
    }
  }

  // Metrics (with TTL for automatic cleanup)
  async saveMetrics(metrics: FlagMetrics): Promise<void> {
    try {
      const timestamp = metrics.period.start;
      const key = `${this.prefix}:metrics:${metrics.flagId}:${timestamp}`;
      
      // Store with 30 day TTL
      const ttl = 30 * 24 * 60 * 60; // 30 days in seconds
      await this.kv.put(key, JSON.stringify(metrics), { expirationTtl: ttl });
    } catch (error) {
      console.error('Error saving metrics to KV:', error);
      throw new Error(`Failed to save metrics: ${error}`);
    }
  }

  async getMetrics(flagId: string, start: number, end: number): Promise<FlagMetrics[]> {
    try {
      const prefix = `${this.prefix}:metrics:${flagId}:`;
      const listResult = await this.kv.list({ prefix });
      const metrics: FlagMetrics[] = [];
      
      for (const key of listResult.keys) {
        const timestamp = parseInt(key.name.split(':').pop() || '0');
        if (timestamp >= start && timestamp <= end) {
          const data = await this.kv.get(key.name, 'json') as FlagMetrics;
          if (data) {
            metrics.push(data);
          }
        }
      }
      
      return metrics.sort((a, b) => a.period.start - b.period.start);
    } catch (error) {
      console.error('Error getting metrics from KV:', error);
      return [];
    }
  }

  // Audit logs (with TTL for automatic cleanup)
  async saveAuditLog(log: FlagAuditLog): Promise<void> {
    try {
      const key = `${this.prefix}:audit:${log.timestamp}:${log.id}`;
      
      // Store with 90 day TTL
      const ttl = 90 * 24 * 60 * 60; // 90 days in seconds
      await this.kv.put(key, JSON.stringify(log), { expirationTtl: ttl });
    } catch (error) {
      console.error('Error saving audit log to KV:', error);
      throw new Error(`Failed to save audit log: ${error}`);
    }
  }

  async getAuditLogs(flagId?: string, limit: number = 100): Promise<FlagAuditLog[]> {
    try {
      const prefix = `${this.prefix}:audit:`;
      const listResult = await this.kv.list({ prefix, limit });
      const logs: FlagAuditLog[] = [];
      
      for (const key of listResult.keys) {
        const data = await this.kv.get(key.name, 'json') as FlagAuditLog;
        if (data && (!flagId || data.flagId === flagId)) {
          logs.push(data);
        }
      }
      
      // Sort by timestamp descending (newest first)
      return logs.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
    } catch (error) {
      console.error('Error getting audit logs from KV:', error);
      return [];
    }
  }

  // Helper methods
  private async updateFlagIndex(flagId: string, action: 'add' | 'remove'): Promise<void> {
    try {
      const indexKey = `${this.prefix}:index:flags`;
      const currentIndex = await this.kv.get(indexKey, 'json') as string[] || [];
      
      if (action === 'add' && !currentIndex.includes(flagId)) {
        currentIndex.push(flagId);
      } else if (action === 'remove') {
        const index = currentIndex.indexOf(flagId);
        if (index > -1) {
          currentIndex.splice(index, 1);
        }
      }
      
      await this.kv.put(indexKey, JSON.stringify(currentIndex));
    } catch (error) {
      console.error('Error updating flag index:', error);
      // Non-critical error, don't throw
    }
  }

  private async deleteAllTenantOverrides(flagId: string): Promise<void> {
    try {
      const prefix = `${this.prefix}:override:`;
      const listResult = await this.kv.list({ prefix });
      
      const deletePromises = listResult.keys
        .filter(key => key.name.endsWith(`:${flagId}`))
        .map(key => this.kv.delete(key.name));
      
      await Promise.all(deletePromises);
    } catch (error) {
      console.error('Error deleting tenant overrides:', error);
      // Non-critical error, don't throw
    }
  }

  private async deleteUserSegment(flagId: string): Promise<void> {
    try {
      const key = `${this.prefix}:segment:${flagId}`;
      await this.kv.delete(key);
    } catch (error) {
      console.error('Error deleting user segment:', error);
      // Non-critical error, don't throw
    }
  }

  // Bulk operations for better performance
  async saveFlagsInBatch(flags: FlagConfig[]): Promise<void> {
    try {
      const promises = flags.map(flag => this.saveFlag(flag));
      await Promise.all(promises);
    } catch (error) {
      console.error('Error saving flags in batch:', error);
      throw new Error(`Failed to save flags in batch: ${error}`);
    }
  }

  async getFlagsInBatch(flagIds: string[]): Promise<Record<string, FlagConfig | null>> {
    try {
      const promises = flagIds.map(async flagId => {
        const flag = await this.getFlag(flagId);
        return { flagId, flag };
      });
      
      const results = await Promise.all(promises);
      const flags: Record<string, FlagConfig | null> = {};
      
      for (const { flagId, flag } of results) {
        flags[flagId] = flag;
      }
      
      return flags;
    } catch (error) {
      console.error('Error getting flags in batch:', error);
      return {};
    }
  }

  // Cache warming - preload frequently accessed flags
  async warmCache(flagIds: string[]): Promise<void> {
    try {
      await this.getFlagsInBatch(flagIds);
    } catch (error) {
      console.error('Error warming cache:', error);
      // Non-critical error, don't throw
    }
  }

  // Health check
  async healthCheck(): Promise<{ healthy: boolean; latency?: number; error?: string }> {
    const start = Date.now();
    try {
      const testKey = `${this.prefix}:health-check`;
      const testValue = { timestamp: start };
      
      await this.kv.put(testKey, JSON.stringify(testValue));
      const retrieved = await this.kv.get(testKey, 'json');
      await this.kv.delete(testKey);
      
      const latency = Date.now() - start;
      
      if (retrieved && (retrieved as any).timestamp === start) {
        return { healthy: true, latency };
      } else {
        return { healthy: false, error: 'Data integrity check failed' };
      }
    } catch (error) {
      return { 
        healthy: false, 
        latency: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}