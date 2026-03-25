/**
 * Consistent hashing utilities for user segmentation
 * Ensures stable assignment to feature flag buckets
 */

/**
 * Simple string hash function for consistent distribution
 * Uses a variation of djb2 hash algorithm
 */
export function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Generate a consistent hash for user segmentation
 * Combines multiple identifiers for more stable assignment
 */
export function generateUserHash(
  identifier: string,
  flagId: string,
  seed: string = 'default'
): number {
  const combined = `${identifier}:${flagId}:${seed}`;
  return hashString(combined);
}

/**
 * Check if user is in percentage bucket (0-100)
 * Uses consistent hashing to ensure stable assignment
 */
export function isInPercentageBucket(
  identifier: string,
  percentage: number,
  flagId: string,
  seed: string = 'default'
): boolean {
  if (percentage <= 0) return false;
  if (percentage >= 100) return true;

  const hash = generateUserHash(identifier, flagId, seed);
  const userPercentage = (hash % 100) + 1; // 1-100 range
  
  return userPercentage <= percentage;
}

/**
 * Get variant bucket for user based on variant weights
 * Ensures consistent assignment to the same variant
 */
export function getVariantBucket(
  identifier: string,
  variants: Array<{ id: string; weight: number }>,
  flagId: string,
  seed: string = 'default'
): string | null {
  if (variants.length === 0) return null;

  // Normalize weights to ensure they sum to 100
  const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0);
  if (totalWeight === 0) return null;

  const normalizedVariants = variants.map(v => ({
    ...v,
    weight: (v.weight / totalWeight) * 100
  }));

  const hash = generateUserHash(identifier, flagId, seed);
  const userPercentage = (hash % 100) + 1; // 1-100 range

  let cumulativeWeight = 0;
  for (const variant of normalizedVariants) {
    cumulativeWeight += variant.weight;
    if (userPercentage <= cumulativeWeight) {
      return variant.id;
    }
  }

  // Fallback to first variant if no match (shouldn't happen)
  return normalizedVariants[0]?.id || null;
}

/**
 * Create a deterministic identifier from evaluation context
 * Falls back to less specific identifiers if primary ones are missing
 */
export function createContextIdentifier(context: {
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  ip?: string;
}): string {
  // Prefer user ID for stickiness
  if (context.userId) {
    return `user:${context.userId}`;
  }

  // Fall back to tenant ID
  if (context.tenantId) {
    return `tenant:${context.tenantId}`;
  }

  // Fall back to session ID
  if (context.sessionId) {
    return `session:${context.sessionId}`;
  }

  // Last resort: IP address
  if (context.ip) {
    return `ip:${context.ip}`;
  }

  // If nothing is available, use a random string
  // This will result in non-sticky behavior
  return `random:${Math.random().toString(36)}`;
}

/**
 * Hash function specifically for cache keys
 * Creates shorter, URL-safe hash strings
 */
export function hashCacheKey(key: string): string {
  const hash = hashString(key);
  return hash.toString(36); // Base36 encoding for shorter strings
}

/**
 * Create a cache key for flag evaluation results
 */
export function createCacheKey(
  flagId: string,
  context: {
    tenantId?: string;
    userId?: string;
    sessionId?: string;
    customAttributes?: Record<string, string | number | boolean>;
  },
  prefix: string = 'flag'
): string {
  const identifier = createContextIdentifier(context);
  
  // Include custom attributes in cache key if present
  let contextHash = identifier;
  if (context.customAttributes && Object.keys(context.customAttributes).length > 0) {
    const attrString = JSON.stringify(context.customAttributes);
    contextHash += `:${hashCacheKey(attrString)}`;
  }

  return `${prefix}:${flagId}:${hashCacheKey(contextHash)}`;
}

/**
 * Generate a unique segment ID for user segmentation
 */
export function generateSegmentId(flagId: string, percentage: number): string {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  return `${flagId}_${percentage}pct_${timestamp}_${randomSuffix}`;
}

/**
 * Validate percentage value
 */
export function validatePercentage(percentage: number): boolean {
  return typeof percentage === 'number' && percentage >= 0 && percentage <= 100;
}

/**
 * Validate variant weights sum to 100
 */
export function validateVariantWeights(variants: Array<{ weight: number }>): boolean {
  const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0);
  return Math.abs(totalWeight - 100) < 0.001; // Allow for floating point precision
}

/**
 * Generate a deployment-specific seed for canary releases
 * Ensures different assignment patterns for different deployments
 */
export function generateDeploymentSeed(deploymentId: string, flagId: string): string {
  return hashCacheKey(`${deploymentId}:${flagId}:canary`);
}