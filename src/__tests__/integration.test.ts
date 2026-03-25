/**
 * Integration tests for the feature flags system
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { 
  createTestFeatureFlags, 
  bootstrapCommonFlags,
  createSimpleFlags,
  createCanaryFlags,
  createABTestFlags
} from '../factory';
import { ConditionBuilder } from '../utils/conditions';
import type { EvaluationContext, BooleanFlagConfig } from '../types';

describe('Feature Flags Integration', () => {
  let system: any;

  beforeEach(async () => {
    system = createTestFeatureFlags();
  });

  describe('Basic Flag Operations', () => {
    it('should create and evaluate a boolean flag', async () => {
      const flag: BooleanFlagConfig = {
        flagId: 'test_flag',
        name: 'Test Flag',
        description: 'A test boolean flag',
        type: 'boolean',
        status: 'enabled',
        defaultValue: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await system.manager.createFlag(flag);

      const context: EvaluationContext = {
        tenantId: 'test-tenant',
        userId: 'test-user'
      };

      const result = await system.manager.evaluateBoolean('test_flag', context);
      expect(result).toBe(false);
    });

    it('should respect tenant overrides', async () => {
      const flag: BooleanFlagConfig = {
        flagId: 'tenant_flag',
        name: 'Tenant Flag',
        description: 'A flag with tenant override',
        type: 'boolean',
        status: 'enabled',
        defaultValue: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await system.manager.createFlag(flag);
      await system.manager.addTenantOverride('special-tenant', 'tenant_flag', true);

      // Regular tenant gets default
      const normalContext: EvaluationContext = { tenantId: 'normal-tenant' };
      const normalResult = await system.manager.evaluateBoolean('tenant_flag', normalContext);
      expect(normalResult).toBe(false);

      // Special tenant gets override
      const specialContext: EvaluationContext = { tenantId: 'special-tenant' };
      const specialResult = await system.manager.evaluateBoolean('tenant_flag', specialContext);
      expect(specialResult).toBe(true);
    });

    it('should evaluate rules correctly', async () => {
      const flag: BooleanFlagConfig = {
        flagId: 'rule_flag',
        name: 'Rule Flag',
        description: 'A flag with rules',
        type: 'boolean',
        status: 'enabled',
        defaultValue: false,
        rules: [
          {
            id: 'premium_rule',
            name: 'Premium Users',
            description: 'Enable for premium users',
            conditions: [
              ConditionBuilder.customAttribute('tier', 'equals', 'premium')
            ],
            priority: 1,
            enabled: true,
            value: true
          }
        ],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await system.manager.createFlag(flag);

      // Regular user gets default
      const regularContext: EvaluationContext = {
        customAttributes: { tier: 'basic' }
      };
      const regularResult = await system.manager.evaluateBoolean('rule_flag', regularContext);
      expect(regularResult).toBe(false);

      // Premium user gets enabled
      const premiumContext: EvaluationContext = {
        customAttributes: { tier: 'premium' }
      };
      const premiumResult = await system.manager.evaluateBoolean('rule_flag', premiumContext);
      expect(premiumResult).toBe(true);
    });
  });

  describe('Percentage Flags', () => {
    it('should consistently assign users to percentage buckets', async () => {
      const flag: any = {
        flagId: 'percentage_flag',
        name: 'Percentage Flag',
        description: 'A percentage rollout flag',
        type: 'percentage',
        status: 'enabled',
        percentage: 50,
        stickyUserId: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await system.manager.createFlag(flag);

      const context: EvaluationContext = {
        userId: 'consistent-user-123'
      };

      // Should get the same result multiple times
      const results = [];
      for (let i = 0; i < 5; i++) {
        const result = await system.manager.evaluateBoolean('percentage_flag', context);
        results.push(result);
      }

      // All results should be the same (sticky)
      const firstResult = results[0];
      expect(results.every(r => r === firstResult)).toBe(true);
    });
  });

  describe('Variant Flags', () => {
    it('should assign users to variants based on weights', async () => {
      const flag: any = {
        flagId: 'variant_flag',
        name: 'Variant Flag',
        description: 'A variant flag for A/B testing',
        type: 'variant',
        status: 'enabled',
        defaultVariant: 'control',
        variants: [
          { id: 'control', name: 'Control', value: 'original', weight: 50 },
          { id: 'variant_a', name: 'Variant A', value: 'new', weight: 50 }
        ],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await system.manager.createFlag(flag);

      const results: string[] = [];
      
      // Test with multiple users
      for (let i = 0; i < 100; i++) {
        const context: EvaluationContext = {
          userId: `user-${i}`
        };
        
        const result = await system.manager.evaluate('variant_flag', context);
        results.push(result.value);
      }

      // Should have both variants assigned
      const hasControl = results.some(r => r === 'original');
      const hasVariant = results.some(r => r === 'new');
      
      expect(hasControl).toBe(true);
      expect(hasVariant).toBe(true);
    });
  });

  describe('Canary Deployments', () => {
    it('should handle canary deployments', async () => {
      const flag: any = {
        flagId: 'canary_flag',
        name: 'Canary Flag',
        description: 'A canary deployment flag',
        type: 'boolean',
        status: 'canary',
        defaultValue: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await system.manager.createFlag(flag);

      const canaryConfig = {
        enabled: true,
        percentage: 25,
        startTime: Date.now(),
        deploymentId: 'test-canary-123',
        description: 'Test canary deployment'
      };

      await system.manager.startCanaryDeployment('canary_flag', canaryConfig);

      // Test multiple users - some should be in canary, some not
      const results: boolean[] = [];
      
      for (let i = 0; i < 100; i++) {
        const context: EvaluationContext = {
          userId: `user-${i}`
        };
        
        const result = await system.manager.evaluateBoolean('canary_flag', context);
        results.push(result);
      }

      const trueCount = results.filter(r => r === true).length;
      const falseCount = results.filter(r => r === false).length;

      // Should have both true and false results (canary percentage)
      expect(trueCount).toBeGreaterThan(0);
      expect(falseCount).toBeGreaterThan(0);
      expect(trueCount + falseCount).toBe(100);
    });
  });

  describe('Performance', () => {
    it('should evaluate flags quickly', async () => {
      const flag: BooleanFlagConfig = {
        flagId: 'perf_flag',
        name: 'Performance Flag',
        description: 'A flag for performance testing',
        type: 'boolean',
        status: 'enabled',
        defaultValue: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await system.manager.createFlag(flag);

      const context: EvaluationContext = {
        tenantId: 'test-tenant',
        userId: 'test-user'
      };

      // Measure evaluation time
      const start = Date.now();
      
      // Evaluate flag multiple times
      for (let i = 0; i < 100; i++) {
        await system.manager.evaluateBoolean('perf_flag', context);
      }
      
      const end = Date.now();
      const totalTime = end - start;
      const avgTime = totalTime / 100;

      // Should be very fast (under 5ms per evaluation on average)
      expect(avgTime).toBeLessThan(5);
    });
  });

  describe('Batch Operations', () => {
    it('should handle batch evaluation', async () => {
      // Create multiple flags
      const flags = [
        {
          flagId: 'batch_flag_1',
          name: 'Batch Flag 1',
          type: 'boolean',
          status: 'enabled',
          defaultValue: true,
          createdAt: Date.now(),
          updatedAt: Date.now()
        },
        {
          flagId: 'batch_flag_2',
          name: 'Batch Flag 2',
          type: 'boolean',
          status: 'enabled',
          defaultValue: false,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ];

      for (const flag of flags) {
        await system.manager.createFlag(flag);
      }

      const context: EvaluationContext = {
        tenantId: 'test-tenant'
      };

      const requests = [
        { flagId: 'batch_flag_1', context, fallback: false },
        { flagId: 'batch_flag_2', context, fallback: true }
      ];

      const results = await system.manager.evaluateMultiple(requests);

      expect(results).toHaveLength(2);
      expect(results[0].flagId).toBe('batch_flag_1');
      expect(results[0].value).toBe(true);
      expect(results[1].flagId).toBe('batch_flag_2');
      expect(results[1].value).toBe(false);
    });
  });

  describe('Health Check', () => {
    it('should pass health check', async () => {
      const health = await system.healthCheck();
      
      expect(health.healthy).toBe(true);
      expect(typeof health.latency).toBe('number');
      expect(health.error).toBeUndefined();
    });
  });

  describe('Bootstrap Common Flags', () => {
    it('should bootstrap common flags', async () => {
      await bootstrapCommonFlags(system);

      // Check that common flags were created
      const enhancedMonitoring = await system.manager.getFlag('enhanced_monitoring');
      expect(enhancedMonitoring).toBeDefined();
      expect(enhancedMonitoring.type).toBe('boolean');

      const websocketRealTime = await system.manager.getFlag('websocket_real_time');
      expect(websocketRealTime).toBeDefined();
      expect(websocketRealTime.defaultValue).toBe(true);

      const maxWorkflowSteps = await system.manager.getFlag('max_workflow_steps');
      expect(maxWorkflowSteps).toBeDefined();
      expect(maxWorkflowSteps.type).toBe('number');
    });
  });

  describe('Preset Flags', () => {
    it('should create simple flags from presets', () => {
      const simpleFlags = createSimpleFlags();

      expect(simpleFlags.simpleToggle.type).toBe('boolean');
      expect(simpleFlags.tenantSpecific.rules).toHaveLength(1);
      expect(simpleFlags.timeWindow.rules?.[0].conditions).toHaveLength(2);
    });

    it('should create canary flags from presets', () => {
      const canaryFlags = createCanaryFlags();

      expect(canaryFlags.gradualRollout.type).toBe('percentage');
      expect(canaryFlags.gradualRollout.percentage).toBe(5);
      expect(canaryFlags.canaryConfig.stages).toHaveLength(3);
    });

    it('should create A/B test flags from presets', () => {
      const abFlags = createABTestFlags();

      expect(abFlags.simpleAB.variants).toHaveLength(2);
      expect(abFlags.multiVariant.variants).toHaveLength(4);
      expect(abFlags.personalizedAB.rules).toHaveLength(2);
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent flags gracefully', async () => {
      const context: EvaluationContext = { tenantId: 'test' };
      
      const result = await system.manager.evaluateBoolean('non_existent_flag', context, true);
      expect(result).toBe(true); // Should return fallback
    });

    it('should handle malformed evaluation contexts', async () => {
      const flag: BooleanFlagConfig = {
        flagId: 'error_flag',
        name: 'Error Flag',
        description: 'A flag for error testing',
        type: 'boolean',
        status: 'enabled',
        defaultValue: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await system.manager.createFlag(flag);

      // Empty context should still work
      const result = await system.manager.evaluateBoolean('error_flag', {});
      expect(result).toBe(true);
    });
  });
});