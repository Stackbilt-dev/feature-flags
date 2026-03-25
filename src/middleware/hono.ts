/**
 * Hono middleware for feature flags
 * Integrates seamlessly with the AI orchestration platform
 */

import { Context, MiddlewareHandler } from 'hono';
import type { 
  FeatureFlagMiddlewareConfig, 
  EvaluationContext,
  FeatureFlagManager,
  FlagEvaluationResult
} from '../types';

// Extended context for feature flags
declare module 'hono' {
  interface ContextVariableMap {
    featureFlags?: FeatureFlagClient;
  }
}

/**
 * Feature flag client attached to request context
 */
export class FeatureFlagClient {
  private context: EvaluationContext;

  constructor(
    private manager: FeatureFlagManager,
    context: EvaluationContext
  ) {
    this.context = context;
  }

  /**
   * Evaluate a feature flag
   */
  async evaluate<T = any>(flagId: string, fallback?: T): Promise<FlagEvaluationResult<T>> {
    return this.manager.evaluate(flagId, this.context, fallback);
  }

  /**
   * Check if a boolean flag is enabled
   */
  async isEnabled(flagId: string, fallback: boolean = false): Promise<boolean> {
    return this.manager.evaluateBoolean(flagId, this.context, fallback);
  }

  /**
   * Get a string flag value
   */
  async getString(flagId: string, fallback: string = ''): Promise<string> {
    return this.manager.evaluateString(flagId, this.context, fallback);
  }

  /**
   * Get a number flag value
   */
  async getNumber(flagId: string, fallback: number = 0): Promise<number> {
    return this.manager.evaluateNumber(flagId, this.context, fallback);
  }

  /**
   * Evaluate multiple flags at once
   */
  async evaluateMultiple<T = any>(
    requests: Array<{ flagId: string; fallback?: T }>
  ): Promise<Array<FlagEvaluationResult<T>>> {
    const fullRequests = requests.map(req => ({
      ...req,
      context: this.context
    }));
    return this.manager.evaluateMultiple(fullRequests);
  }

  /**
   * Check multiple boolean flags
   */
  async checkMultiple(
    flagIds: string[], 
    fallback: boolean = false
  ): Promise<Record<string, boolean>> {
    const requests = flagIds.map(flagId => ({ flagId, fallback }));
    const results = await this.evaluateMultiple(requests);
    
    return results.reduce((acc, result) => {
      acc[result.flagId] = result.value as boolean;
      return acc;
    }, {} as Record<string, boolean>);
  }

  /**
   * Update evaluation context for subsequent calls
   */
  updateContext(updates: Partial<EvaluationContext>): void {
    this.context = { ...this.context, ...updates };
  }

  /**
   * Get current evaluation context
   */
  getContext(): EvaluationContext {
    return { ...this.context };
  }
}

/**
 * Default context extractor for AI orchestration platform
 */
export function defaultContextExtractor(c: Context): EvaluationContext {
  // Extract standard context from Hono context
  const context: EvaluationContext = {
    timestamp: Date.now()
  };

  // Extract tenant ID from various sources
  context.tenantId = 
    c.get('tenantId') ||
    c.req.header('X-Tenant-ID') ||
    c.req.query('tenantId');

  // Extract user ID from various sources
  context.userId = 
    c.get('userId') ||
    c.req.header('X-User-ID') ||
    c.req.query('userId');

  // Extract session ID
  context.sessionId = 
    c.get('sessionId') ||
    c.req.header('X-Session-ID') ||
    c.req.query('sessionId');

  // Extract IP address
  context.ip = 
    c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Forwarded-For') ||
    c.req.header('X-Real-IP');

  // Extract user agent
  context.userAgent = c.req.header('User-Agent');

  // Extract custom attributes from headers or query params
  const customAttributes: Record<string, string | number | boolean> = {};
  
  // Check for custom attribute headers (X-FF-Attr-*)
  for (const [key, value] of Object.entries(c.req.raw.headers || {})) {
    if (key.toLowerCase().startsWith('x-ff-attr-')) {
      const attrName = key.substring(11).toLowerCase(); // Remove 'x-ff-attr-' prefix
      customAttributes[attrName] = value;
    }
  }
  
  // Check for custom attributes in query params (ff_attr_*)
  const url = new URL(c.req.url);
  for (const [key, value] of url.searchParams.entries()) {
    if (key.startsWith('ff_attr_')) {
      const attrName = key.substring(8); // Remove 'ff_attr_' prefix
      // Try to parse as number or boolean
      let parsedValue: string | number | boolean = value;
      if (value === 'true') parsedValue = true;
      else if (value === 'false') parsedValue = false;
      else if (!isNaN(Number(value))) parsedValue = Number(value);
      
      customAttributes[attrName] = parsedValue;
    }
  }

  if (Object.keys(customAttributes).length > 0) {
    context.customAttributes = customAttributes;
  }

  return context;
}

/**
 * Create feature flag middleware for Hono
 */
export function createFeatureFlagMiddleware(
  config: FeatureFlagMiddlewareConfig
): MiddlewareHandler {
  return async (c: Context, next) => {
    try {
      // Extract evaluation context
      const contextExtractor = config.contextExtractor || defaultContextExtractor;
      const context = contextExtractor(c);
      
      // Create feature flag client
      const flagClient = new FeatureFlagClient(config.manager, context);
      
      // Attach to context
      c.set('featureFlags', flagClient);
      
      await next();
    } catch (error) {
      console.error('Error in feature flag middleware:', error);
      
      if (config.onEvaluationError) {
        config.onEvaluationError(error as Error, 'middleware', {});
      }
      
      // Continue with request even if feature flags fail
      await next();
    }
  };
}

/**
 * Helper function to check a flag in a route handler
 */
export async function checkFlag(
  c: Context, 
  flagId: string, 
  fallback: boolean = false
): Promise<boolean> {
  const flagClient = c.get('featureFlags');
  if (!flagClient) {
    console.warn('Feature flags not available in context. Did you add the middleware?');
    return fallback;
  }
  
  return flagClient.isEnabled(flagId, fallback);
}

/**
 * Higher-order function to conditionally apply handlers based on feature flags
 */
export function withFlag(
  flagId: string,
  enabledHandler: MiddlewareHandler,
  disabledHandler?: MiddlewareHandler,
  fallback: boolean = false
): MiddlewareHandler {
  return async (c: Context, next) => {
    const isEnabled = await checkFlag(c, flagId, fallback);
    
    if (isEnabled) {
      return enabledHandler(c, next);
    } else if (disabledHandler) {
      return disabledHandler(c, next);
    } else {
      // Skip this handler
      await next();
    }
  };
}

/**
 * Route guard that requires a feature flag to be enabled
 */
export function requireFlag(
  flagId: string, 
  fallback: boolean = false,
  errorResponse?: { status: number; message: string }
): MiddlewareHandler {
  return async (c: Context, next) => {
    const isEnabled = await checkFlag(c, flagId, fallback);
    
    if (!isEnabled) {
      const error = errorResponse || { 
        status: 404, 
        message: 'Feature not available' 
      };
      return c.json({ error: error.message }, error.status as any);
    }
    
    await next();
  };
}

/**
 * Middleware to add feature flag information to response headers
 */
export function addFlagHeaders(flagIds: string[]): MiddlewareHandler {
  return async (c: Context, next) => {
    await next();
    
    const flagClient = c.get('featureFlags');
    if (!flagClient) return;
    
    try {
      const flags = await flagClient.checkMultiple(flagIds);
      
      for (const [flagId, enabled] of Object.entries(flags)) {
        c.header(`X-Feature-${flagId}`, enabled.toString());
      }
    } catch (error) {
      console.error('Error adding flag headers:', error);
    }
  };
}

/**
 * A/B testing middleware that sets a variant in the context
 */
export function withVariant(
  flagId: string,
  handlers: Record<string, MiddlewareHandler>,
  defaultHandler?: MiddlewareHandler
): MiddlewareHandler {
  return async (c: Context, next) => {
    const flagClient = c.get('featureFlags');
    if (!flagClient) {
      if (defaultHandler) {
        return defaultHandler(c, next);
      }
      await next();
      return;
    }
    
    try {
      const result = await flagClient.evaluate(flagId);
      const variant = result.variant || 'default';
      
      // Set variant in context for other middleware/handlers
      c.set('variant', variant);
      
      const handler = handlers[variant] || defaultHandler;
      if (handler) {
        return handler(c, next);
      }
      
      await next();
    } catch (error) {
      console.error('Error in variant middleware:', error);
      if (defaultHandler) {
        return defaultHandler(c, next);
      }
      await next();
    }
  };
}

/**
 * Performance tracking middleware for feature flag evaluations
 */
export function trackFlagPerformance(): MiddlewareHandler {
  return async (c: Context, next) => {
    const start = Date.now();
    
    await next();
    
    const flagClient = c.get('featureFlags');
    if (!flagClient) return;
    
    const duration = Date.now() - start;
    
    // Add performance metrics to response headers
    c.header('X-Flag-Eval-Time', duration.toString());
    
    // Log slow evaluations
    if (duration > 10) {
      console.warn(`Slow feature flag evaluation: ${duration}ms for ${c.req.url}`);
    }
  };
}

/**
 * Utility to get flag evaluation results with metadata
 */
export async function getFlagWithMetadata<T = any>(
  c: Context,
  flagId: string,
  fallback?: T
): Promise<FlagEvaluationResult<T> | null> {
  const flagClient = c.get('featureFlags');
  if (!flagClient) {
    return null;
  }
  
  return flagClient.evaluate(flagId, fallback);
}

/**
 * Type-safe flag checking with TypeScript
 */
export interface FlagDefinition<T = boolean> {
  id: string;
  fallback: T;
  description?: string;
}

export async function checkTypedFlag<T>(
  c: Context,
  flag: FlagDefinition<T>
): Promise<T> {
  const flagClient = c.get('featureFlags');
  if (!flagClient) {
    return flag.fallback;
  }
  
  if (typeof flag.fallback === 'boolean') {
    return flagClient.isEnabled(flag.id, flag.fallback as boolean) as Promise<T>;
  } else if (typeof flag.fallback === 'string') {
    return flagClient.getString(flag.id, flag.fallback as string) as Promise<T>;
  } else if (typeof flag.fallback === 'number') {
    return flagClient.getNumber(flag.id, flag.fallback as number) as Promise<T>;
  } else {
    const result = await flagClient.evaluate(flag.id, flag.fallback);
    return result.value;
  }
}

// Common flag definitions for the AI orchestration platform
export const FLAGS = {
  USE_NEW_CHAT_AGENT: {
    id: 'use_new_chat_agent',
    fallback: false,
    description: 'Use the new chat agent implementation'
  } as FlagDefinition<boolean>,
  
  ENHANCED_MONITORING: {
    id: 'enhanced_monitoring',
    fallback: false,
    description: 'Enable enhanced monitoring features'
  } as FlagDefinition<boolean>,
  
  WEBSOCKET_REAL_TIME: {
    id: 'websocket_real_time',
    fallback: true,
    description: 'Enable real-time WebSocket updates'
  } as FlagDefinition<boolean>,
  
  MAX_WORKFLOW_STEPS: {
    id: 'max_workflow_steps',
    fallback: 10,
    description: 'Maximum number of steps in a workflow'
  } as FlagDefinition<number>,
  
  AI_MODEL_VERSION: {
    id: 'ai_model_version',
    fallback: 'gpt-3.5-turbo',
    description: 'AI model version to use'
  } as FlagDefinition<string>
};