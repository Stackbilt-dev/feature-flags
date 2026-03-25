/**
 * Admin API router for feature flag management
 */

import { Hono } from 'hono';
import type { FeatureFlagManager, FlagConfig, CanaryConfig, TenantOverride } from '../types';
import { validatePercentage, validateVariantWeights } from '../utils/hash';
import { validateCondition, ConditionBuilder } from '../utils/conditions';

export interface AdminRouterConfig {
  manager: FeatureFlagManager;
  authMiddleware?: (c: any, next: any) => Promise<void>;
  corsHeaders?: boolean;
}

export function createAdminRouter(config: AdminRouterConfig) {
  const app = new Hono();
  const { manager } = config;

  // Apply auth middleware if provided
  if (config.authMiddleware) {
    app.use('*', config.authMiddleware);
  }

  // CORS headers if enabled
  if (config.corsHeaders) {
    app.use('*', async (c, next) => {
      c.header('Access-Control-Allow-Origin', '*');
      c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      
      if (c.req.method === 'OPTIONS') {
        return c.text('OK');
      }
      
      await next();
    });
  }

  // Health check
  app.get('/health', async (c) => {
    try {
      const health = await manager.healthCheck();
      return c.json(health, health.healthy ? 200 : 503);
    } catch (error) {
      return c.json({ 
        healthy: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }, 503);
    }
  });

  // Get all flags
  app.get('/flags', async (c) => {
    try {
      const flags = await (manager as any).config.storage.getAllFlags();
      return c.json({ flags });
    } catch (error) {
      console.error('Error getting flags:', error);
      return c.json({ error: 'Failed to get flags' }, 500);
    }
  });

  // Get single flag
  app.get('/flags/:flagId', async (c) => {
    try {
      const flagId = c.req.param('flagId');
      const flag = await manager.getFlag(flagId);
      
      if (!flag) {
        return c.json({ error: 'Flag not found' }, 404);
      }
      
      return c.json({ flag });
    } catch (error) {
      console.error('Error getting flag:', error);
      return c.json({ error: 'Failed to get flag' }, 500);
    }
  });

  // Create flag
  app.post('/flags', async (c) => {
    try {
      const flagData = await c.req.json();
      
      // Validate flag data
      const validationErrors = validateFlagData(flagData);
      if (validationErrors.length > 0) {
        return c.json({ 
          error: 'Validation failed', 
          details: validationErrors 
        }, 400);
      }
      
      const flag = await manager.createFlag(flagData);
      return c.json({ flag }, 201);
    } catch (error) {
      console.error('Error creating flag:', error);
      return c.json({ 
        error: error instanceof Error ? error.message : 'Failed to create flag' 
      }, 500);
    }
  });

  // Update flag
  app.put('/flags/:flagId', async (c) => {
    try {
      const flagId = c.req.param('flagId');
      const updates = await c.req.json();
      
      // Validate updates
      const validationErrors = validateFlagData(updates, true);
      if (validationErrors.length > 0) {
        return c.json({ 
          error: 'Validation failed', 
          details: validationErrors 
        }, 400);
      }
      
      const flag = await manager.updateFlag(flagId, updates);
      return c.json({ flag });
    } catch (error) {
      console.error('Error updating flag:', error);
      return c.json({ 
        error: error instanceof Error ? error.message : 'Failed to update flag' 
      }, 500);
    }
  });

  // Delete flag
  app.delete('/flags/:flagId', async (c) => {
    try {
      const flagId = c.req.param('flagId');
      await manager.deleteFlag(flagId);
      return c.json({ message: 'Flag deleted successfully' });
    } catch (error) {
      console.error('Error deleting flag:', error);
      return c.json({ 
        error: error instanceof Error ? error.message : 'Failed to delete flag' 
      }, 500);
    }
  });

  // Flag evaluation endpoint for testing
  app.post('/flags/:flagId/evaluate', async (c) => {
    try {
      const flagId = c.req.param('flagId');
      const { context, fallback } = await c.req.json();
      
      const result = await manager.evaluate(flagId, context, fallback);
      return c.json({ result });
    } catch (error) {
      console.error('Error evaluating flag:', error);
      return c.json({ 
        error: error instanceof Error ? error.message : 'Failed to evaluate flag' 
      }, 500);
    }
  });

  // Tenant overrides
  app.get('/flags/:flagId/overrides', async (c) => {
    try {
      const flagId = c.req.param('flagId');
      const tenantId = c.req.query('tenantId');
      
      if (tenantId) {
        const override = await (manager as any).config.storage.getTenantOverride(tenantId, flagId);
        return c.json({ override });
      } else {
        // Get all overrides for this flag (this would require a new storage method)
        return c.json({ message: 'Please specify tenantId parameter' }, 400);
      }
    } catch (error) {
      console.error('Error getting tenant override:', error);
      return c.json({ error: 'Failed to get tenant override' }, 500);
    }
  });

  app.post('/flags/:flagId/overrides', async (c) => {
    try {
      const flagId = c.req.param('flagId');
      const { tenantId, value, variant, startTime, endTime, reason } = await c.req.json();
      
      if (!tenantId) {
        return c.json({ error: 'tenantId is required' }, 400);
      }
      
      const override: TenantOverride = {
        tenantId,
        flagId,
        value,
        variant,
        enabled: true,
        startTime,
        endTime,
        reason,
        createdAt: Date.now()
      };
      
      await (manager as any).config.storage.saveTenantOverride(override);
      return c.json({ override }, 201);
    } catch (error) {
      console.error('Error creating tenant override:', error);
      return c.json({ error: 'Failed to create tenant override' }, 500);
    }
  });

  app.delete('/flags/:flagId/overrides/:tenantId', async (c) => {
    try {
      const flagId = c.req.param('flagId');
      const tenantId = c.req.param('tenantId');
      
      await manager.removeTenantOverride(tenantId, flagId);
      return c.json({ message: 'Tenant override removed successfully' });
    } catch (error) {
      console.error('Error removing tenant override:', error);
      return c.json({ error: 'Failed to remove tenant override' }, 500);
    }
  });

  // Canary deployments
  app.get('/flags/:flagId/canary', async (c) => {
    try {
      const flagId = c.req.param('flagId');
      const canary = await (manager as any).config.storage.getCanaryConfig(flagId);
      return c.json({ canary });
    } catch (error) {
      console.error('Error getting canary config:', error);
      return c.json({ error: 'Failed to get canary config' }, 500);
    }
  });

  app.post('/flags/:flagId/canary', async (c) => {
    try {
      const flagId = c.req.param('flagId');
      const canaryData = await c.req.json();
      
      // Validate canary data
      const validationErrors = validateCanaryData(canaryData);
      if (validationErrors.length > 0) {
        return c.json({ 
          error: 'Validation failed', 
          details: validationErrors 
        }, 400);
      }
      
      await manager.startCanaryDeployment(flagId, canaryData);
      return c.json({ message: 'Canary deployment started', canary: canaryData }, 201);
    } catch (error) {
      console.error('Error starting canary deployment:', error);
      return c.json({ error: 'Failed to start canary deployment' }, 500);
    }
  });

  app.put('/flags/:flagId/canary', async (c) => {
    try {
      const flagId = c.req.param('flagId');
      const updates = await c.req.json();
      
      await manager.updateCanaryDeployment(flagId, updates);
      return c.json({ message: 'Canary deployment updated' });
    } catch (error) {
      console.error('Error updating canary deployment:', error);
      return c.json({ error: 'Failed to update canary deployment' }, 500);
    }
  });

  app.delete('/flags/:flagId/canary', async (c) => {
    try {
      const flagId = c.req.param('flagId');
      await manager.stopCanaryDeployment(flagId);
      return c.json({ message: 'Canary deployment stopped' });
    } catch (error) {
      console.error('Error stopping canary deployment:', error);
      return c.json({ error: 'Failed to stop canary deployment' }, 500);
    }
  });

  // Canary rollout controls
  app.post('/flags/:flagId/canary/advance', async (c) => {
    try {
      const flagId = c.req.param('flagId');
      const { percentage } = await c.req.json();
      
      if (!validatePercentage(percentage)) {
        return c.json({ error: 'Invalid percentage value' }, 400);
      }
      
      const existing = await (manager as any).config.storage.getCanaryConfig(flagId);
      if (!existing) {
        return c.json({ error: 'No canary deployment found' }, 404);
      }
      
      if (percentage <= existing.percentage) {
        return c.json({ 
          error: `New percentage ${percentage}% must be greater than current ${existing.percentage}%` 
        }, 400);
      }
      
      await manager.updateCanaryDeployment(flagId, { percentage });
      return c.json({ 
        message: `Canary advanced from ${existing.percentage}% to ${percentage}%`,
        percentage 
      });
    } catch (error) {
      console.error('Error advancing canary:', error);
      return c.json({ error: 'Failed to advance canary' }, 500);
    }
  });

  app.post('/flags/:flagId/canary/complete', async (c) => {
    try {
      const flagId = c.req.param('flagId');
      
      await manager.updateCanaryDeployment(flagId, { percentage: 100 });
      await manager.stopCanaryDeployment(flagId);
      
      return c.json({ message: 'Canary deployment completed' });
    } catch (error) {
      console.error('Error completing canary:', error);
      return c.json({ error: 'Failed to complete canary' }, 500);
    }
  });

  app.post('/flags/:flagId/canary/rollback', async (c) => {
    try {
      const flagId = c.req.param('flagId');
      const { reason } = await c.req.json();
      
      await manager.stopCanaryDeployment(flagId);
      
      // Log the rollback
      console.warn(`[ROLLBACK] Canary rollback for flag ${flagId}: ${reason || 'No reason provided'}`);
      
      return c.json({ 
        message: 'Canary deployment rolled back',
        reason 
      });
    } catch (error) {
      console.error('Error rolling back canary:', error);
      return c.json({ error: 'Failed to rollback canary' }, 500);
    }
  });

  // Metrics
  app.get('/flags/:flagId/metrics', async (c) => {
    try {
      const flagId = c.req.param('flagId');
      const start = parseInt(c.req.query('start') || '0') || Date.now() - (24 * 60 * 60 * 1000);
      const end = parseInt(c.req.query('end') || '0') || Date.now();
      
      const metrics = await manager.getMetrics(flagId, { start, end });
      return c.json({ metrics });
    } catch (error) {
      console.error('Error getting metrics:', error);
      return c.json({ error: 'Failed to get metrics' }, 500);
    }
  });

  // Audit logs
  app.get('/audit', async (c) => {
    try {
      const flagId = c.req.query('flagId');
      const limit = parseInt(c.req.query('limit') || '100');
      
      const logs = await manager.getAuditLogs(flagId, limit);
      return c.json({ logs });
    } catch (error) {
      console.error('Error getting audit logs:', error);
      return c.json({ error: 'Failed to get audit logs' }, 500);
    }
  });

  // Bulk operations
  app.post('/flags/bulk/evaluate', async (c) => {
    try {
      const { requests } = await c.req.json();
      
      if (!Array.isArray(requests)) {
        return c.json({ error: 'requests must be an array' }, 400);
      }
      
      const results = await manager.evaluateMultiple(requests);
      return c.json({ results });
    } catch (error) {
      console.error('Error bulk evaluating flags:', error);
      return c.json({ error: 'Failed to bulk evaluate flags' }, 500);
    }
  });

  // Flag templates for common patterns
  app.get('/templates', async (c) => {
    const templates = {
      boolean: {
        flagId: 'example_boolean_flag',
        name: 'Example Boolean Flag',
        description: 'A simple on/off feature flag',
        type: 'boolean',
        status: 'enabled',
        defaultValue: false,
        rules: [
          {
            id: 'rule_1',
            name: 'Enable for specific tenant',
            description: 'Enable this feature for tenant-123',
            conditions: [ConditionBuilder.tenantEquals('tenant-123')],
            priority: 1,
            enabled: true,
            value: true
          }
        ]
      },
      percentage: {
        flagId: 'example_percentage_flag',
        name: 'Example Percentage Flag',
        description: 'Gradual rollout feature flag',
        type: 'percentage',
        status: 'enabled',
        percentage: 25,
        stickyUserId: true,
        rules: []
      },
      variant: {
        flagId: 'example_variant_flag',
        name: 'Example Variant Flag',
        description: 'A/B testing feature flag',
        type: 'variant',
        status: 'enabled',
        defaultVariant: 'control',
        variants: [
          { id: 'control', name: 'Control', value: 'original', weight: 50 },
          { id: 'variant_a', name: 'Variant A', value: 'new_feature', weight: 50 }
        ],
        rules: []
      }
    };
    
    return c.json({ templates });
  });

  return app;
}

// Validation functions
function validateFlagData(data: any, isUpdate: boolean = false): string[] {
  const errors: string[] = [];
  
  if (!isUpdate) {
    if (!data.flagId || typeof data.flagId !== 'string') {
      errors.push('flagId is required and must be a string');
    }
    
    if (!data.name || typeof data.name !== 'string') {
      errors.push('name is required and must be a string');
    }
    
    if (!data.type || !['boolean', 'percentage', 'variant', 'string', 'number'].includes(data.type)) {
      errors.push('type is required and must be one of: boolean, percentage, variant, string, number');
    }
  }
  
  if (data.status && !['enabled', 'disabled', 'canary', 'archived'].includes(data.status)) {
    errors.push('status must be one of: enabled, disabled, canary, archived');
  }
  
  // Type-specific validations
  if (data.type === 'percentage' && data.percentage !== undefined) {
    if (!validatePercentage(data.percentage)) {
      errors.push('percentage must be a number between 0 and 100');
    }
  }
  
  if (data.type === 'variant' && data.variants) {
    if (!Array.isArray(data.variants)) {
      errors.push('variants must be an array');
    } else {
      if (!validateVariantWeights(data.variants)) {
        errors.push('variant weights must sum to 100');
      }
      
      for (const variant of data.variants) {
        if (!variant.id || !variant.name || typeof variant.weight !== 'number') {
          errors.push('each variant must have id, name, and weight properties');
          break;
        }
      }
    }
  }
  
  // Validate rules
  if (data.rules && Array.isArray(data.rules)) {
    for (let i = 0; i < data.rules.length; i++) {
      const rule = data.rules[i];
      
      if (!rule.id || !rule.conditions || !Array.isArray(rule.conditions)) {
        errors.push(`rule ${i + 1} must have id and conditions array`);
        continue;
      }
      
      if (typeof rule.priority !== 'number') {
        errors.push(`rule ${i + 1} must have a numeric priority`);
      }
      
      for (let j = 0; j < rule.conditions.length; j++) {
        const conditionErrors = validateCondition(rule.conditions[j]);
        if (conditionErrors.length > 0) {
          errors.push(`rule ${i + 1}, condition ${j + 1}: ${conditionErrors.join(', ')}`);
        }
      }
    }
  }
  
  return errors;
}

function validateCanaryData(data: any): string[] {
  const errors: string[] = [];
  
  if (typeof data.enabled !== 'boolean') {
    errors.push('enabled is required and must be a boolean');
  }
  
  if (!validatePercentage(data.percentage)) {
    errors.push('percentage is required and must be between 0 and 100');
  }
  
  if (!data.deploymentId || typeof data.deploymentId !== 'string') {
    errors.push('deploymentId is required and must be a string');
  }
  
  if (typeof data.startTime !== 'number') {
    errors.push('startTime is required and must be a timestamp');
  }
  
  if (data.endTime && typeof data.endTime !== 'number') {
    errors.push('endTime must be a timestamp if provided');
  }
  
  if (data.stages && Array.isArray(data.stages)) {
    for (let i = 0; i < data.stages.length; i++) {
      const stage = data.stages[i];
      
      if (!stage.name || typeof stage.name !== 'string') {
        errors.push(`stage ${i + 1} must have a name`);
      }
      
      if (!validatePercentage(stage.percentage)) {
        errors.push(`stage ${i + 1} must have a valid percentage`);
      }
      
      if (typeof stage.duration !== 'number') {
        errors.push(`stage ${i + 1} must have a duration in milliseconds`);
      }
    }
  }
  
  return errors;
}