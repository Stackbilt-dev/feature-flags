/**
 * Feature Flag Manager - Core evaluation engine
 * Optimized for <5ms latency with caching and fast evaluation
 */

import type {
  FeatureFlagManager as IFeatureFlagManager,
  FeatureFlagManagerConfig,
  FlagConfig,
  BooleanFlagConfig,
  PercentageFlagConfig,
  VariantFlagConfig,
  ValueFlagConfig,
  EvaluationContext,
  FlagEvaluationResult,
  EvaluationReason,
  TenantOverride,
  CanaryConfig,
  FlagMetrics,
  FlagAuditLog,
  AuditAction
} from '../types';

import { 
  createContextIdentifier, 
  isInPercentageBucket, 
  getVariantBucket,
  createCacheKey,
  generateDeploymentSeed
} from '../utils/hash';

import { evaluateAllConditions, isRuleActive } from '../utils/conditions';

export class FeatureFlagManager implements IFeatureFlagManager {
  private cache = new Map<string, any>();
  private metrics = new Map<string, { count: number; times: number[] }>();

  constructor(private config: FeatureFlagManagerConfig) {}

  /**
   * Main evaluation method - optimized for speed
   */
  async evaluate<T = any>(
    flagId: string, 
    context: EvaluationContext, 
    fallback?: T
  ): Promise<FlagEvaluationResult<T>> {
    const start = Date.now();
    
    try {
      // Add timestamp to context if not present
      const enrichedContext = {
        ...context,
        timestamp: context.timestamp || Date.now()
      };

      // Check cache first
      const cacheKey = createCacheKey(flagId, enrichedContext, this.config.cachePrefix);
      const cached = await this.getCachedResult<T>(cacheKey);
      if (cached) {
        this.recordMetrics(flagId, Date.now() - start);
        return cached;
      }

      // Get flag configuration
      const flag = await this.config.storage.getFlag(flagId);
      if (!flag) {
        const result = this.createResult(flagId, fallback, 'fallback', start) as FlagEvaluationResult<T>;
        await this.cacheResult(cacheKey, result);
        return result;
      }

      // Check if flag is archived or disabled
      if (flag.status === 'archived') {
        const result = this.createResult(flagId, fallback, 'flag_archived', start) as FlagEvaluationResult<T>;
        await this.cacheResult(cacheKey, result);
        return result;
      }

      if (flag.status === 'disabled') {
        const result = this.createResult(flagId, fallback, 'flag_disabled', start) as FlagEvaluationResult<T>;
        await this.cacheResult(cacheKey, result);
        return result;
      }

      // Check tenant override first (highest priority)
      if (enrichedContext.tenantId) {
        const override = await this.config.storage.getTenantOverride(
          enrichedContext.tenantId, 
          flagId
        );
        if (override && this.isOverrideActive(override)) {
          const result = this.createResult(
            flagId, 
            override.value, 
            'tenant_override', 
            start,
            override.variant
          );
          await this.cacheResult(cacheKey, result);
          return result;
        }
      }

      // Check canary deployment
      if (flag.status === 'canary') {
        const canaryConfig = await this.config.storage.getCanaryConfig(flagId);
        if (canaryConfig && this.isCanaryActive(canaryConfig)) {
          const identifier = createContextIdentifier(enrichedContext);
          const seed = generateDeploymentSeed(canaryConfig.deploymentId, flagId);
          
          if (isInPercentageBucket(identifier, canaryConfig.percentage, flagId, seed)) {
            const result = await this.evaluateFlag(flag, enrichedContext, start) as FlagEvaluationResult<T>;
            await this.cacheResult(cacheKey, result);
            return result;
          } else {
            // Not in canary - return default value
            const result = this.createResult(flagId, this.getDefaultValue(flag), 'default', start) as FlagEvaluationResult<T>;
            await this.cacheResult(cacheKey, result);
            return result;
          }
        }
      }

      // Normal flag evaluation
      const result = await this.evaluateFlag(flag, enrichedContext, start) as FlagEvaluationResult<T>;
      await this.cacheResult(cacheKey, result);
      return result;

    } catch (error) {
      console.error(`Error evaluating flag ${flagId}:`, error);
      const result = this.createResult(flagId, fallback, 'evaluation_error', start) as FlagEvaluationResult<T>;
      return result;
    } finally {
      this.recordMetrics(flagId, Date.now() - start);
    }
  }

  /**
   * Evaluate boolean flags with default fallback
   */
  async evaluateBoolean(
    flagId: string, 
    context: EvaluationContext, 
    fallback: boolean = false
  ): Promise<boolean> {
    const result = await this.evaluate<boolean>(flagId, context, fallback);
    return result.value;
  }

  /**
   * Evaluate string flags with default fallback
   */
  async evaluateString(
    flagId: string, 
    context: EvaluationContext, 
    fallback: string = ''
  ): Promise<string> {
    const result = await this.evaluate<string>(flagId, context, fallback);
    return result.value;
  }

  /**
   * Evaluate number flags with default fallback
   */
  async evaluateNumber(
    flagId: string, 
    context: EvaluationContext, 
    fallback: number = 0
  ): Promise<number> {
    const result = await this.evaluate<number>(flagId, context, fallback);
    return result.value;
  }

  /**
   * Flag management methods
   */
  async getFlag(flagId: string): Promise<FlagConfig | null> {
    return this.config.storage.getFlag(flagId);
  }

  async createFlag(flag: Omit<FlagConfig, 'createdAt' | 'updatedAt'>): Promise<FlagConfig> {
    const now = Date.now();
    const newFlag: FlagConfig = {
      ...flag,
      createdAt: now,
      updatedAt: now
    } as FlagConfig;

    await this.config.storage.saveFlag(newFlag);
    
    if (this.config.enableAudit) {
      await this.logAudit('created', newFlag.flagId, undefined, newFlag);
    }

    // Clear related cache entries
    await this.clearFlagCache(newFlag.flagId);

    return newFlag;
  }

  async updateFlag(flagId: string, updates: Partial<FlagConfig>): Promise<FlagConfig> {
    const existing = await this.config.storage.getFlag(flagId);
    if (!existing) {
      throw new Error(`Flag ${flagId} not found`);
    }

    const updated = {
      ...existing,
      ...updates,
      updatedAt: Date.now()
    } as FlagConfig;

    await this.config.storage.saveFlag(updated);
    
    if (this.config.enableAudit) {
      await this.logAudit('updated', flagId, existing, updated);
    }

    // Clear related cache entries
    await this.clearFlagCache(flagId);
    
    return updated;
  }

  async deleteFlag(flagId: string): Promise<void> {
    const existing = await this.config.storage.getFlag(flagId);
    
    await this.config.storage.deleteFlag(flagId);
    
    if (this.config.enableAudit && existing) {
      await this.logAudit('archived', flagId, existing, undefined);
    }

    // Clear related cache entries
    await this.clearFlagCache(flagId);
  }

  /**
   * Tenant override methods
   */
  async addTenantOverride(tenantId: string, flagId: string, value: any): Promise<void> {
    const override: TenantOverride = {
      tenantId,
      flagId,
      value,
      enabled: true,
      createdAt: Date.now()
    };

    await this.config.storage.saveTenantOverride(override);
    
    if (this.config.enableAudit) {
      await this.logAudit('override_added', flagId, undefined, { tenantId, value } as any);
    }

    // Clear related cache entries
    await this.clearFlagCache(flagId);
  }

  async removeTenantOverride(tenantId: string, flagId: string): Promise<void> {
    await this.config.storage.deleteTenantOverride(tenantId, flagId);
    
    if (this.config.enableAudit) {
      await this.logAudit('override_removed', flagId, { tenantId } as any, undefined);
    }

    // Clear related cache entries
    await this.clearFlagCache(flagId);
  }

  /**
   * Canary deployment methods
   */
  async startCanaryDeployment(flagId: string, config: CanaryConfig): Promise<void> {
    await this.config.storage.saveCanaryConfig(flagId, config);
    
    // Update flag status to canary
    await this.updateFlag(flagId, { status: 'canary' });
  }

  async updateCanaryDeployment(flagId: string, updates: Partial<CanaryConfig>): Promise<void> {
    const existing = await this.config.storage.getCanaryConfig(flagId);
    if (!existing) {
      throw new Error(`No canary config found for flag ${flagId}`);
    }

    const updated = { ...existing, ...updates };
    await this.config.storage.saveCanaryConfig(flagId, updated);
    
    // Clear related cache entries
    await this.clearFlagCache(flagId);
  }

  async stopCanaryDeployment(flagId: string): Promise<void> {
    await this.config.storage.deleteCanaryConfig(flagId);
    
    // Update flag status back to enabled
    await this.updateFlag(flagId, { status: 'enabled' });
  }

  /**
   * Metrics and audit methods
   */
  async getMetrics(flagId: string, period?: { start: number; end: number }): Promise<FlagMetrics[]> {
    const start = period?.start || Date.now() - (24 * 60 * 60 * 1000); // Default: last 24 hours
    const end = period?.end || Date.now();
    
    return this.config.storage.getMetrics(flagId, start, end);
  }

  async getAuditLogs(flagId?: string, limit: number = 100): Promise<FlagAuditLog[]> {
    return this.config.storage.getAuditLogs(flagId, limit);
  }

  /**
   * Private helper methods
   */
  private async evaluateFlag(
    flag: FlagConfig,
    context: EvaluationContext,
    startTime: number
  ): Promise<FlagEvaluationResult<any>> {
    // Check rules first (sorted by priority)
    const rules = this.getRules(flag);
    if (rules && rules.length > 0) {
      // Sort by priority (higher priority = lower number)
      const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);
      
      for (const rule of sortedRules) {
        if (!isRuleActive(rule)) continue;
        
        const { matches, matchedConditions } = evaluateAllConditions(rule.conditions, context);
        if (matches) {
          const value = this.getRuleValue(rule, flag, context);
          return this.createResult(
            flag.flagId, 
            value, 
            'rule_match', 
            startTime,
            undefined,
            rule.id,
            matchedConditions
          );
        }
      }
    }

    // No rules matched, evaluate based on flag type
    switch (flag.type) {
      case 'boolean':
        return this.createResult(flag.flagId, (flag as BooleanFlagConfig).defaultValue, 'default', startTime);
      
      case 'percentage':
        const percentageFlag = flag as PercentageFlagConfig;
        const identifier = createContextIdentifier(context);
        const inBucket = isInPercentageBucket(identifier, percentageFlag.percentage, flag.flagId);
        return this.createResult(
          flag.flagId, 
          inBucket, 
          'percentage_rollout', 
          startTime,
          undefined,
          undefined,
          [],
          percentageFlag.stickyUserId && context.userId ? true : false
        );
      
      case 'variant':
        const variantFlag = flag as VariantFlagConfig;
        const userIdentifier = createContextIdentifier(context);
        const selectedVariant = getVariantBucket(userIdentifier, variantFlag.variants, flag.flagId);
        const variant = variantFlag.variants.find(v => v.id === selectedVariant);
        return this.createResult(
          flag.flagId, 
          variant?.value || variantFlag.variants.find(v => v.id === variantFlag.defaultVariant)?.value, 
          'percentage_rollout', 
          startTime,
          selectedVariant || variantFlag.defaultVariant
        );
      
      case 'string':
      case 'number':
        return this.createResult(flag.flagId, (flag as ValueFlagConfig).defaultValue, 'default', startTime);
      
      default:
        return this.createResult((flag as any).flagId, undefined, 'evaluation_error', startTime);
    }
  }

  private getRules(flag: FlagConfig): any[] | undefined {
    switch (flag.type) {
      case 'boolean':
        return (flag as BooleanFlagConfig).rules;
      case 'percentage':
        return (flag as PercentageFlagConfig).rules;
      case 'variant':
        return (flag as VariantFlagConfig).rules;
      case 'string':
      case 'number':
        return (flag as ValueFlagConfig).rules;
      default:
        return undefined;
    }
  }

  private getRuleValue(rule: any, flag: FlagConfig, context: EvaluationContext): any {
    if ('value' in rule) {
      return rule.value;
    }
    
    if ('percentage' in rule) {
      const identifier = createContextIdentifier(context);
      return isInPercentageBucket(identifier, rule.percentage, flag.flagId);
    }
    
    if ('variant' in rule) {
      const variant = (flag as VariantFlagConfig).variants.find(v => v.id === rule.variant);
      return variant?.value;
    }
    
    return this.getDefaultValue(flag);
  }

  private getDefaultValue(flag: FlagConfig): any {
    switch (flag.type) {
      case 'boolean':
        return (flag as BooleanFlagConfig).defaultValue;
      case 'percentage':
        return false;
      case 'variant':
        const variantFlag = flag as VariantFlagConfig;
        const defaultVariant = variantFlag.variants.find(v => v.id === variantFlag.defaultVariant);
        return defaultVariant?.value;
      case 'string':
      case 'number':
        return (flag as ValueFlagConfig).defaultValue;
      default:
        return undefined;
    }
  }

  private createResult<T>(
    flagId: string,
    value: T,
    reason: EvaluationReason,
    startTime: number,
    variant?: string,
    ruleId?: string,
    matchedConditions?: string[],
    sticky?: boolean
  ): FlagEvaluationResult<T> {
    return {
      flagId,
      value,
      variant,
      reason,
      ruleId,
      matchedConditions,
      evaluationTime: Date.now() - startTime,
      sticky
    };
  }

  private isOverrideActive(override: TenantOverride): boolean {
    if (!override.enabled) return false;
    
    const now = Date.now();
    if (override.startTime && now < override.startTime) return false;
    if (override.endTime && now > override.endTime) return false;
    
    return true;
  }

  private isCanaryActive(canary: CanaryConfig): boolean {
    if (!canary.enabled) return false;
    
    const now = Date.now();
    if (now < canary.startTime) return false;
    if (canary.endTime && now > canary.endTime) return false;
    
    return true;
  }

  private async getCachedResult<T>(cacheKey: string): Promise<FlagEvaluationResult<T> | null> {
    if (!this.config.cacheNamespace) return null;
    
    try {
      const cached = await this.config.cacheNamespace.get(cacheKey, 'json');
      if (cached && (cached as any).expiresAt > Date.now()) {
        return (cached as any).result as FlagEvaluationResult<T>;
      }
    } catch (error) {
      console.error('Error getting cached result:', error);
    }
    
    return null;
  }

  private async cacheResult<T>(cacheKey: string, result: FlagEvaluationResult<T>): Promise<void> {
    if (!this.config.cacheNamespace) return;
    
    try {
      const cacheTtl = this.config.cacheTtl || 300; // Default 5 minutes
      const cacheEntry = {
        result,
        expiresAt: Date.now() + (cacheTtl * 1000)
      };
      
      await this.config.cacheNamespace.put(
        cacheKey, 
        JSON.stringify(cacheEntry), 
        { expirationTtl: cacheTtl }
      );
    } catch (error) {
      console.error('Error caching result:', error);
    }
  }

  private async clearFlagCache(flagId: string): Promise<void> {
    if (!this.config.cacheNamespace) return;
    
    try {
      // Clear all cache entries for this flag
      const prefix = `${this.config.cachePrefix || 'flag'}:${flagId}:`;
      const list = await this.config.cacheNamespace.list({ prefix });
      
      const deletePromises = list.keys.map(key => 
        this.config.cacheNamespace!.delete(key.name)
      );
      
      await Promise.all(deletePromises);
    } catch (error) {
      console.error('Error clearing flag cache:', error);
    }
  }

  private recordMetrics(flagId: string, evaluationTime: number): void {
    if (!this.config.enableMetrics) return;
    
    const key = flagId;
    const existing = this.metrics.get(key) || { count: 0, times: [] };
    
    existing.count++;
    existing.times.push(evaluationTime);
    
    // Keep only last 1000 evaluation times to avoid memory bloat
    if (existing.times.length > 1000) {
      existing.times = existing.times.slice(-1000);
    }
    
    this.metrics.set(key, existing);
  }

  private async logAudit(
    action: AuditAction,
    flagId: string,
    before?: Partial<FlagConfig>,
    after?: Partial<FlagConfig>
  ): Promise<void> {
    if (!this.config.enableAudit) return;
    
    try {
      const log: FlagAuditLog = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2)}`,
        flagId,
        action,
        before,
        after,
        timestamp: Date.now()
      };
      
      await this.config.storage.saveAuditLog(log);
    } catch (error) {
      console.error('Error logging audit event:', error);
    }
  }

  /**
   * Batch evaluation for multiple flags
   */
  async evaluateMultiple<T = any>(
    requests: Array<{ flagId: string; context: EvaluationContext; fallback?: T }>
  ): Promise<Array<FlagEvaluationResult<T>>> {
    const promises = requests.map(req => 
      this.evaluate(req.flagId, req.context, req.fallback)
    );
    
    return Promise.all(promises);
  }

  /**
   * Health check for the manager
   */
  async healthCheck(): Promise<{ healthy: boolean; latency?: number; error?: string }> {
    const start = Date.now();
    
    try {
      // Test storage health
      const storageHealth = await (this.config.storage as any).healthCheck?.();
      
      // Test cache health if available
      let cacheHealth = { healthy: true };
      if (this.config.cacheNamespace) {
        try {
          const testKey = 'health-check-' + Date.now();
          await this.config.cacheNamespace.put(testKey, 'test');
          await this.config.cacheNamespace.get(testKey);
          await this.config.cacheNamespace.delete(testKey);
        } catch (error) {
          cacheHealth = { healthy: false };
        }
      }
      
      const latency = Date.now() - start;
      const healthy = storageHealth?.healthy !== false && cacheHealth.healthy;
      
      return { 
        healthy, 
        latency,
        error: healthy ? undefined : 'Storage or cache health check failed'
      };
    } catch (error) {
      return {
        healthy: false,
        latency: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}