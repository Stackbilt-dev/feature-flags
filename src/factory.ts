/**
 * Factory functions for easy feature flag system setup
 */

import { FeatureFlagManager } from './core/manager';
import { KVFlagStorage } from './core/kv-storage';
import type { FeatureFlagManagerConfig, FeatureFlagEnv } from './types';

export interface FeatureFlagSystemConfig {
  env: FeatureFlagEnv;
  storagePrefix?: string;
  cachePrefix?: string;
  cacheTtl?: number;
  enableMetrics?: boolean;
  enableAudit?: boolean;
  evaluationTimeout?: number;
  defaultEnvironment?: string;
}

export interface FeatureFlagSystem {
  manager: FeatureFlagManager;
  storage: KVFlagStorage;
  healthCheck: () => Promise<{ healthy: boolean; latency?: number; error?: string }>;
}

/**
 * Create a complete feature flag system with KV storage
 */
export function createFeatureFlagSystem(config: FeatureFlagSystemConfig): FeatureFlagSystem {
  // Validate required KV namespace
  if (!config.env.FEATURE_FLAGS_KV) {
    throw new Error('FEATURE_FLAGS_KV namespace is required for feature flags');
  }

  // Create storage layer
  const storage = new KVFlagStorage(
    config.env.FEATURE_FLAGS_KV,
    config.storagePrefix || 'flags'
  );

  // Create manager configuration
  const managerConfig: FeatureFlagManagerConfig = {
    storage,
    cacheNamespace: config.env.FEATURE_FLAGS_CACHE,
    cachePrefix: config.cachePrefix || 'flag',
    cacheTtl: config.cacheTtl || 300, // 5 minutes default
    evaluationTimeout: config.evaluationTimeout || 5000, // 5 seconds default
    enableMetrics: config.enableMetrics ?? true,
    enableAudit: config.enableAudit ?? true,
    defaultEnvironment: config.defaultEnvironment || 'production'
  };

  // Create manager
  const manager = new FeatureFlagManager(managerConfig);

  // Health check function
  const healthCheck = async () => {
    const start = Date.now();
    try {
      const [storageHealth, managerHealth] = await Promise.all([
        storage.healthCheck(),
        manager.healthCheck()
      ]);

      const latency = Date.now() - start;
      const healthy = storageHealth.healthy && managerHealth.healthy;

      return {
        healthy,
        latency,
        error: healthy ? undefined : 'Storage or manager health check failed'
      };
    } catch (error) {
      return {
        healthy: false,
        latency: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  };

  return {
    manager,
    storage,
    healthCheck
  };
}

/**
 * Create a feature flag system with development-friendly defaults
 */
export function createDevelopmentFeatureFlags(env: FeatureFlagEnv): FeatureFlagSystem {
  return createFeatureFlagSystem({
    env,
    storagePrefix: 'dev-flags',
    cachePrefix: 'dev-flag',
    cacheTtl: 60, // 1 minute cache in development
    enableMetrics: true,
    enableAudit: true,
    evaluationTimeout: 10000, // 10 seconds in development
    defaultEnvironment: 'development'
  });
}

/**
 * Create a feature flag system optimized for production
 */
export function createProductionFeatureFlags(env: FeatureFlagEnv): FeatureFlagSystem {
  return createFeatureFlagSystem({
    env,
    storagePrefix: 'prod-flags',
    cachePrefix: 'prod-flag',
    cacheTtl: 300, // 5 minutes cache in production
    enableMetrics: true,
    enableAudit: true,
    evaluationTimeout: 2000, // 2 seconds in production for fast responses
    defaultEnvironment: 'production'
  });
}

/**
 * Create a lightweight feature flag system (no caching, minimal features)
 */
export function createLightweightFeatureFlags(env: FeatureFlagEnv): FeatureFlagSystem {
  if (!env.FEATURE_FLAGS_KV) {
    throw new Error('FEATURE_FLAGS_KV namespace is required');
  }

  const storage = new KVFlagStorage(env.FEATURE_FLAGS_KV, 'lite-flags');
  
  const managerConfig: FeatureFlagManagerConfig = {
    storage,
    // No caching for lightweight setup
    enableMetrics: false,
    enableAudit: false,
    evaluationTimeout: 1000 // 1 second timeout
  };

  const manager = new FeatureFlagManager(managerConfig);

  return {
    manager,
    storage,
    healthCheck: () => storage.healthCheck()
  };
}

/**
 * Bootstrap common feature flags for the AI orchestration platform
 */
export async function bootstrapCommonFlags(system: FeatureFlagSystem): Promise<void> {
  const { manager } = system;

  // Common flags for the AI orchestration platform
  const commonFlags = [
    {
      flagId: 'enhanced_monitoring',
      name: 'Enhanced Monitoring',
      description: 'Enable enhanced monitoring and observability features',
      type: 'boolean' as const,
      status: 'enabled' as const,
      defaultValue: false,
      tags: ['monitoring', 'observability']
    },
    {
      flagId: 'websocket_real_time',
      name: 'WebSocket Real-time Updates',
      description: 'Enable real-time WebSocket updates for workflows',
      type: 'boolean' as const,
      status: 'enabled' as const,
      defaultValue: true,
      tags: ['websocket', 'real-time']
    },
    {
      flagId: 'max_workflow_steps',
      name: 'Maximum Workflow Steps',
      description: 'Maximum number of steps allowed in a workflow',
      type: 'number' as const,
      status: 'enabled' as const,
      defaultValue: 10,
      tags: ['workflow', 'limits']
    },
    {
      flagId: 'ai_model_version',
      name: 'AI Model Version',
      description: 'Version of AI model to use for chat agent',
      type: 'string' as const,
      status: 'enabled' as const,
      defaultValue: 'gpt-3.5-turbo',
      tags: ['ai', 'model']
    },
    {
      flagId: 'new_chat_agent',
      name: 'New Chat Agent',
      description: 'Use the new chat agent implementation',
      type: 'percentage' as const,
      status: 'enabled' as const,
      percentage: 10, // 10% rollout
      stickyUserId: true,
      tags: ['chat', 'agent', 'rollout']
    }
  ];

  // Create flags that don't exist
  for (const flagData of commonFlags) {
    try {
      const existing = await manager.getFlag(flagData.flagId);
      if (!existing) {
        await manager.createFlag(flagData);
        console.log(`Created common flag: ${flagData.flagId}`);
      }
    } catch (error) {
      console.error(`Failed to create flag ${flagData.flagId}:`, error);
    }
  }
}

/**
 * Migrate flags from old format to new format
 */
export async function migrateLegacyFlags(
  system: FeatureFlagSystem,
  legacyFlags: any[]
): Promise<{ migrated: number; failed: number; errors: string[] }> {
  const { manager } = system;
  let migrated = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const legacyFlag of legacyFlags) {
    try {
      // Convert legacy flag format to new format
      const newFlag = convertLegacyFlag(legacyFlag);
      
      // Check if flag already exists
      const existing = await manager.getFlag(newFlag.flagId);
      if (existing) {
        console.log(`Flag ${newFlag.flagId} already exists, skipping`);
        continue;
      }

      await manager.createFlag(newFlag);
      migrated++;
      console.log(`Migrated flag: ${newFlag.flagId}`);
    } catch (error) {
      failed++;
      const errorMessage = `Failed to migrate flag ${legacyFlag.id || 'unknown'}: ${error}`;
      errors.push(errorMessage);
      console.error(errorMessage);
    }
  }

  return { migrated, failed, errors };
}

/**
 * Convert legacy flag format to new format
 */
function convertLegacyFlag(legacyFlag: any): any {
  // This is a placeholder - implement based on your legacy format
  return {
    flagId: legacyFlag.id || legacyFlag.key,
    name: legacyFlag.name,
    description: legacyFlag.description,
    type: legacyFlag.type || 'boolean',
    status: legacyFlag.enabled ? 'enabled' : 'disabled',
    defaultValue: legacyFlag.defaultValue || false,
    tags: legacyFlag.tags || []
  };
}

/**
 * Warm up the cache with frequently used flags
 */
export async function warmupCache(
  system: FeatureFlagSystem,
  flagIds: string[]
): Promise<void> {
  const { storage } = system;
  
  try {
    await storage.warmCache(flagIds);
    console.log(`Warmed up cache for ${flagIds.length} flags`);
  } catch (error) {
    console.error('Failed to warm up cache:', error);
  }
}

/**
 * Create a test feature flag system with in-memory storage
 */
export function createTestFeatureFlags(): FeatureFlagSystem {
  // For testing, we'll use a mock KV namespace
  const mockKV = createMockKV();
  
  const storage = new KVFlagStorage(mockKV as any, 'test-flags');
  
  const managerConfig: FeatureFlagManagerConfig = {
    storage,
    enableMetrics: false,
    enableAudit: false,
    evaluationTimeout: 1000
  };

  const manager = new FeatureFlagManager(managerConfig);

  return {
    manager,
    storage,
    healthCheck: async () => ({ healthy: true, latency: 0 })
  };
}

/**
 * Create a mock KV namespace for testing
 */
function createMockKV() {
  const store = new Map<string, string>();
  
  return {
    async get(key: string, type?: string) {
      const value = store.get(key);
      if (!value) return null;
      
      if (type === 'json') {
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      }
      
      return value;
    },
    
    async put(key: string, value: string, options?: any) {
      store.set(key, value);
    },
    
    async delete(key: string) {
      store.delete(key);
    },
    
    async list(options?: any) {
      const keys = Array.from(store.keys());
      const filtered = options?.prefix 
        ? keys.filter(key => key.startsWith(options.prefix))
        : keys;
      
      return {
        keys: filtered.map(name => ({ name }))
      };
    }
  };
}