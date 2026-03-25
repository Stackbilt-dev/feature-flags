/**
 * Feature Flag Types
 */

// Core flag types
export type FlagType = 'boolean' | 'percentage' | 'variant' | 'string' | 'number';
export type FlagStatus = 'enabled' | 'disabled' | 'canary' | 'archived';

// Flag evaluation context
export interface EvaluationContext {
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  ip?: string;
  userAgent?: string;
  customAttributes?: Record<string, string | number | boolean>;
  timestamp?: number;
}

// Base flag configuration
export interface BaseFlagConfig {
  flagId: string;
  name: string;
  description?: string;
  type: FlagType;
  status: FlagStatus;
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
  tags?: string[];
  environments?: string[];
}

// Boolean flag configuration
export interface BooleanFlagConfig extends BaseFlagConfig {
  type: 'boolean';
  defaultValue: boolean;
  rules?: BooleanRule[];
}

// Percentage flag configuration
export interface PercentageFlagConfig extends BaseFlagConfig {
  type: 'percentage';
  percentage: number;
  stickyUserId?: boolean; // Consistent assignment based on user ID
  rules?: PercentageRule[];
}

// Variant flag configuration
export interface VariantFlagConfig extends BaseFlagConfig {
  type: 'variant';
  variants: FlagVariant[];
  defaultVariant: string;
  rules?: VariantRule[];
}

// String/Number flag configuration
export interface ValueFlagConfig extends BaseFlagConfig {
  type: 'string' | 'number';
  defaultValue: string | number;
  rules?: ValueRule[];
}

// Union type for all flag configurations
export type FlagConfig = BooleanFlagConfig | PercentageFlagConfig | VariantFlagConfig | ValueFlagConfig;

// Flag variants for A/B testing
export interface FlagVariant {
  id: string;
  name: string;
  value: any;
  weight: number; // 0-100, total weights should add up to 100
  description?: string;
}

// Rule definitions
export interface BaseRule {
  id: string;
  name?: string;
  description?: string;
  conditions: Condition[];
  priority: number;
  enabled: boolean;
  startTime?: number;
  endTime?: number;
}

export interface BooleanRule extends BaseRule {
  value: boolean;
}

export interface PercentageRule extends BaseRule {
  percentage: number;
}

export interface VariantRule extends BaseRule {
  variant: string;
}

export interface ValueRule extends BaseRule {
  value: string | number;
}

// Condition for rule evaluation
export interface Condition {
  attribute: string; // e.g., 'tenantId', 'userId', 'customAttributes.plan'
  operator: ComparisonOperator;
  value: string | number | boolean | string[];
  negate?: boolean;
}

export type ComparisonOperator =
  | 'equals'
  | 'not_equals'
  | 'in'
  | 'not_in'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'greater_than'
  | 'greater_than_or_equal'
  | 'less_than'
  | 'less_than_or_equal'
  | 'matches_regex'
  | 'exists'
  | 'not_exists';

// Evaluation result
export interface FlagEvaluationResult<T = any> {
  flagId: string;
  value: T;
  variant?: string;
  reason: EvaluationReason;
  ruleId?: string;
  matchedConditions?: string[];
  evaluationTime: number;
  sticky?: boolean;
}

export type EvaluationReason =
  | 'default'
  | 'rule_match'
  | 'percentage_rollout'
  | 'tenant_override'
  | 'flag_disabled'
  | 'flag_archived'
  | 'evaluation_error'
  | 'fallback';

// Canary deployment configuration
export interface CanaryConfig {
  enabled: boolean;
  percentage: number;
  startTime: number;
  endTime?: number;
  deploymentId: string;
  description?: string;
  autoAdvance?: boolean;
  advanceThreshold?: number; // Percentage to auto-advance to next stage
  stages?: CanaryStage[];
}

export interface CanaryStage {
  name: string;
  percentage: number;
  duration: number; // Duration in milliseconds
  healthCheck?: string; // URL for health check
  metricsThreshold?: CanaryMetrics;
}

export interface CanaryMetrics {
  errorRate?: number; // Max error rate %
  latencyP95?: number; // Max P95 latency in ms
  successRate?: number; // Min success rate %
}

// Tenant-specific overrides
export interface TenantOverride {
  tenantId: string;
  flagId: string;
  value: any;
  variant?: string;
  enabled: boolean;
  startTime?: number;
  endTime?: number;
  reason?: string;
  createdBy?: string;
  createdAt: number;
}

// User segment for consistent assignment
export interface UserSegment {
  segmentId: string;
  flagId: string;
  percentage: number;
  seed: string; // For consistent hashing
  createdAt: number;
}

// Flag evaluation cache entry
export interface CacheEntry<T = any> {
  flagId: string;
  context: EvaluationContext;
  result: FlagEvaluationResult<T>;
  expiresAt: number;
  createdAt: number;
}

// Admin interface types
export interface FlagMetrics {
  flagId: string;
  evaluations: number;
  uniqueUsers: number;
  variantDistribution?: Record<string, number>;
  evaluationTime: {
    avg: number;
    p95: number;
    p99: number;
  };
  period: {
    start: number;
    end: number;
  };
}

export interface FlagAuditLog {
  id: string;
  flagId: string;
  action: AuditAction;
  before?: Partial<FlagConfig>;
  after?: Partial<FlagConfig>;
  userId?: string;
  tenantId?: string;
  timestamp: number;
  reason?: string;
  ip?: string;
}

export type AuditAction =
  | 'created'
  | 'updated'
  | 'enabled'
  | 'disabled'
  | 'archived'
  | 'rule_added'
  | 'rule_updated'
  | 'rule_removed'
  | 'override_added'
  | 'override_removed';

// Storage interface for different backends
export interface FlagStorage {
  getFlag(flagId: string): Promise<FlagConfig | null>;
  getAllFlags(): Promise<FlagConfig[]>;
  saveFlag(flag: FlagConfig): Promise<void>;
  deleteFlag(flagId: string): Promise<void>;
  
  getTenantOverride(tenantId: string, flagId: string): Promise<TenantOverride | null>;
  saveTenantOverride(override: TenantOverride): Promise<void>;
  deleteTenantOverride(tenantId: string, flagId: string): Promise<void>;
  
  getCanaryConfig(flagId: string): Promise<CanaryConfig | null>;
  saveCanaryConfig(flagId: string, config: CanaryConfig): Promise<void>;
  deleteCanaryConfig(flagId: string): Promise<void>;
  
  getUserSegment(flagId: string): Promise<UserSegment | null>;
  saveUserSegment(segment: UserSegment): Promise<void>;
  
  saveMetrics(metrics: FlagMetrics): Promise<void>;
  getMetrics(flagId: string, start: number, end: number): Promise<FlagMetrics[]>;
  
  saveAuditLog(log: FlagAuditLog): Promise<void>;
  getAuditLogs(flagId?: string, limit?: number): Promise<FlagAuditLog[]>;
}

// Feature flag manager configuration
export interface FeatureFlagManagerConfig {
  storage: FlagStorage;
  cacheNamespace?: KVNamespace;
  cachePrefix?: string;
  cacheTtl?: number;
  evaluationTimeout?: number;
  enableMetrics?: boolean;
  enableAudit?: boolean;
  defaultEnvironment?: string;
}

// Middleware configuration for Hono integration
export interface FeatureFlagMiddlewareConfig {
  manager: FeatureFlagManager;
  contextExtractor?: (c: any) => EvaluationContext;
  onEvaluationError?: (error: Error, flagId: string, context: EvaluationContext) => any;
}

// Forward declaration for manager (defined in core)
export interface FeatureFlagManager {
  evaluate<T = any>(flagId: string, context: EvaluationContext, fallback?: T): Promise<FlagEvaluationResult<T>>;
  evaluateBoolean(flagId: string, context: EvaluationContext, fallback?: boolean): Promise<boolean>;
  evaluateString(flagId: string, context: EvaluationContext, fallback?: string): Promise<string>;
  evaluateNumber(flagId: string, context: EvaluationContext, fallback?: number): Promise<number>;
  evaluateMultiple<T = any>(requests: Array<{ flagId: string; context: EvaluationContext; fallback?: T }>): Promise<Array<FlagEvaluationResult<T>>>;

  getFlag(flagId: string): Promise<FlagConfig | null>;
  createFlag(flag: Omit<FlagConfig, 'createdAt' | 'updatedAt'>): Promise<FlagConfig>;
  updateFlag(flagId: string, updates: Partial<FlagConfig>): Promise<FlagConfig>;
  deleteFlag(flagId: string): Promise<void>;

  addTenantOverride(tenantId: string, flagId: string, value: any): Promise<void>;
  removeTenantOverride(tenantId: string, flagId: string): Promise<void>;

  startCanaryDeployment(flagId: string, config: CanaryConfig): Promise<void>;
  updateCanaryDeployment(flagId: string, updates: Partial<CanaryConfig>): Promise<void>;
  stopCanaryDeployment(flagId: string): Promise<void>;

  getMetrics(flagId: string, period?: { start: number; end: number }): Promise<FlagMetrics[]>;
  getAuditLogs(flagId?: string, limit?: number): Promise<FlagAuditLog[]>;
  healthCheck(): Promise<{ healthy: boolean; latency?: number; error?: string }>;
}

// Environment bindings for feature flags on Cloudflare Workers
export interface FeatureFlagEnv {
  FEATURE_FLAGS_KV?: KVNamespace;
  FEATURE_FLAGS_CACHE?: KVNamespace;
  FEATURE_FLAGS_ANALYTICS?: AnalyticsEngineDataset;
  [key: string]: unknown;
}