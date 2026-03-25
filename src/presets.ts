/**
 * Preset configurations for common feature flag patterns
 */

import type { BooleanFlagConfig, PercentageFlagConfig, VariantFlagConfig, CanaryConfig } from './types';
import { ConditionBuilder } from './utils/conditions';

/**
 * Create a simple boolean feature flag
 */
export function createSimpleFlags(): {
  simpleToggle: BooleanFlagConfig;
  tenantSpecific: BooleanFlagConfig;
  timeWindow: BooleanFlagConfig;
} {
  const now = Date.now();
  
  return {
    // Basic on/off toggle
    simpleToggle: {
      flagId: 'simple_toggle',
      name: 'Simple Toggle',
      description: 'A basic on/off feature flag',
      type: 'boolean',
      status: 'enabled',
      defaultValue: false,
      createdAt: now,
      updatedAt: now,
      tags: ['simple', 'toggle']
    },

    // Tenant-specific flag
    tenantSpecific: {
      flagId: 'tenant_specific_feature',
      name: 'Tenant Specific Feature',
      description: 'Feature enabled for specific tenants',
      type: 'boolean',
      status: 'enabled',
      defaultValue: false,
      rules: [
        {
          id: 'enable_for_premium_tenants',
          name: 'Enable for Premium Tenants',
          description: 'Enable this feature for premium tier tenants',
          conditions: [
            ConditionBuilder.customAttribute('tier', 'equals', 'premium')
          ],
          priority: 1,
          enabled: true,
          value: true
        }
      ],
      createdAt: now,
      updatedAt: now,
      tags: ['tenant', 'premium']
    },

    // Time-window flag
    timeWindow: {
      flagId: 'time_window_feature',
      name: 'Time Window Feature',
      description: 'Feature available during specific time window',
      type: 'boolean',
      status: 'enabled',
      defaultValue: false,
      rules: [
        {
          id: 'business_hours_only',
          name: 'Business Hours Only',
          description: 'Enable during business hours (9 AM - 5 PM UTC)',
          conditions: [
            // This would need custom logic for time-based conditions
            ConditionBuilder.customAttribute('hour', 'greater_than_or_equal', 9),
            ConditionBuilder.customAttribute('hour', 'less_than', 17)
          ],
          priority: 1,
          enabled: true,
          startTime: now,
          endTime: now + (30 * 24 * 60 * 60 * 1000), // 30 days
          value: true
        }
      ],
      createdAt: now,
      updatedAt: now,
      tags: ['time', 'business-hours']
    }
  };
}

/**
 * Create canary deployment feature flags
 */
export function createCanaryFlags(): {
  gradualRollout: PercentageFlagConfig;
  canaryConfig: CanaryConfig;
} {
  const now = Date.now();
  
  return {
    // Gradual percentage rollout
    gradualRollout: {
      flagId: 'gradual_rollout_feature',
      name: 'Gradual Rollout Feature',
      description: 'Feature rolled out gradually to percentage of users',
      type: 'percentage',
      status: 'canary',
      percentage: 5, // Start with 5%
      stickyUserId: true, // Consistent assignment
      rules: [
        {
          id: 'beta_users_100_percent',
          name: 'Beta Users 100%',
          description: 'Give beta users full access',
          conditions: [
            ConditionBuilder.customAttribute('beta_user', 'equals', true)
          ],
          priority: 1,
          enabled: true,
          percentage: 100
        }
      ],
      createdAt: now,
      updatedAt: now,
      tags: ['rollout', 'canary', 'percentage']
    },

    // Canary deployment configuration
    canaryConfig: {
      enabled: true,
      percentage: 5,
      startTime: now,
      endTime: now + (7 * 24 * 60 * 60 * 1000), // 7 days
      deploymentId: `canary-${Date.now()}`,
      description: 'Canary deployment for new feature',
      autoAdvance: true,
      advanceThreshold: 95, // Auto-advance if 95% success rate
      stages: [
        {
          name: 'Initial Canary',
          percentage: 5,
          duration: 2 * 60 * 60 * 1000, // 2 hours
          metricsThreshold: {
            errorRate: 1, // Max 1% error rate
            latencyP95: 500, // Max 500ms P95 latency
            successRate: 95 // Min 95% success rate
          }
        },
        {
          name: 'Expanded Canary',
          percentage: 25,
          duration: 4 * 60 * 60 * 1000, // 4 hours
          metricsThreshold: {
            errorRate: 0.5,
            latencyP95: 400,
            successRate: 98
          }
        },
        {
          name: 'Full Rollout',
          percentage: 100,
          duration: 24 * 60 * 60 * 1000, // 24 hours
          metricsThreshold: {
            errorRate: 0.1,
            latencyP95: 300,
            successRate: 99
          }
        }
      ]
    }
  };
}

/**
 * Create A/B testing feature flags
 */
export function createABTestFlags(): {
  simpleAB: VariantFlagConfig;
  multiVariant: VariantFlagConfig;
  personalizedAB: VariantFlagConfig;
} {
  const now = Date.now();
  
  return {
    // Simple A/B test
    simpleAB: {
      flagId: 'simple_ab_test',
      name: 'Simple A/B Test',
      description: 'Simple A/B test between two variants',
      type: 'variant',
      status: 'enabled',
      defaultVariant: 'control',
      variants: [
        {
          id: 'control',
          name: 'Control',
          value: { theme: 'default', buttonColor: 'blue' },
          weight: 50,
          description: 'Original version'
        },
        {
          id: 'variant_a',
          name: 'Variant A',
          value: { theme: 'modern', buttonColor: 'green' },
          weight: 50,
          description: 'New modern theme'
        }
      ],
      createdAt: now,
      updatedAt: now,
      tags: ['ab-test', 'ui', 'theme']
    },

    // Multi-variant test
    multiVariant: {
      flagId: 'multi_variant_test',
      name: 'Multi-Variant Test',
      description: 'Multi-variant test with different algorithm approaches',
      type: 'variant',
      status: 'enabled',
      defaultVariant: 'control',
      variants: [
        {
          id: 'control',
          name: 'Control',
          value: { algorithm: 'original', timeout: 5000 },
          weight: 25,
          description: 'Original algorithm'
        },
        {
          id: 'fast_algo',
          name: 'Fast Algorithm',
          value: { algorithm: 'fast', timeout: 2000 },
          weight: 25,
          description: 'New fast algorithm'
        },
        {
          id: 'accurate_algo',
          name: 'Accurate Algorithm',
          value: { algorithm: 'accurate', timeout: 10000 },
          weight: 25,
          description: 'More accurate algorithm'
        },
        {
          id: 'balanced_algo',
          name: 'Balanced Algorithm',
          value: { algorithm: 'balanced', timeout: 5000 },
          weight: 25,
          description: 'Balanced speed and accuracy'
        }
      ],
      createdAt: now,
      updatedAt: now,
      tags: ['ab-test', 'algorithm', 'performance']
    },

    // Personalized A/B test
    personalizedAB: {
      flagId: 'personalized_ab_test',
      name: 'Personalized A/B Test',
      description: 'A/B test with personalization based on user attributes',
      type: 'variant',
      status: 'enabled',
      defaultVariant: 'control',
      variants: [
        {
          id: 'control',
          name: 'Control',
          value: { experience: 'standard' },
          weight: 40,
          description: 'Standard experience'
        },
        {
          id: 'premium',
          name: 'Premium Experience',
          value: { experience: 'premium' },
          weight: 30,
          description: 'Premium user experience'
        },
        {
          id: 'simplified',
          name: 'Simplified Experience',
          value: { experience: 'simplified' },
          weight: 30,
          description: 'Simplified for new users'
        }
      ],
      rules: [
        {
          id: 'premium_users_get_premium',
          name: 'Premium Users Get Premium Experience',
          description: 'Premium subscribers always get premium experience',
          conditions: [
            ConditionBuilder.customAttribute('subscription', 'equals', 'premium')
          ],
          priority: 1,
          enabled: true,
          variant: 'premium'
        },
        {
          id: 'new_users_get_simplified',
          name: 'New Users Get Simplified',
          description: 'Users with less than 7 days get simplified experience',
          conditions: [
            ConditionBuilder.customAttribute('days_since_signup', 'less_than', 7)
          ],
          priority: 2,
          enabled: true,
          variant: 'simplified'
        }
      ],
      createdAt: now,
      updatedAt: now,
      tags: ['ab-test', 'personalization', 'ux']
    }
  };
}

/**
 * Create feature flags for different environments
 */
export function createEnvironmentFlags(): {
  development: BooleanFlagConfig[];
  staging: BooleanFlagConfig[];
  production: BooleanFlagConfig[];
} {
  const now = Date.now();
  
  return {
    development: [
      {
        flagId: 'debug_mode',
        name: 'Debug Mode',
        description: 'Enable debug logging and verbose output',
        type: 'boolean',
        status: 'enabled',
        defaultValue: true,
        environments: ['development'],
        createdAt: now,
        updatedAt: now,
        tags: ['debug', 'development']
      },
      {
        flagId: 'mock_external_services',
        name: 'Mock External Services',
        description: 'Use mock implementations for external services',
        type: 'boolean',
        status: 'enabled',
        defaultValue: true,
        environments: ['development'],
        createdAt: now,
        updatedAt: now,
        tags: ['mock', 'external', 'development']
      }
    ],

    staging: [
      {
        flagId: 'load_test_mode',
        name: 'Load Test Mode',
        description: 'Enable load testing optimizations',
        type: 'boolean',
        status: 'enabled',
        defaultValue: false,
        environments: ['staging'],
        createdAt: now,
        updatedAt: now,
        tags: ['load-test', 'staging']
      },
      {
        flagId: 'staging_data_reset',
        name: 'Staging Data Reset',
        description: 'Allow resetting staging environment data',
        type: 'boolean',
        status: 'enabled',
        defaultValue: true,
        environments: ['staging'],
        createdAt: now,
        updatedAt: now,
        tags: ['data-reset', 'staging']
      }
    ],

    production: [
      {
        flagId: 'maintenance_mode',
        name: 'Maintenance Mode',
        description: 'Enable maintenance mode banner',
        type: 'boolean',
        status: 'enabled',
        defaultValue: false,
        environments: ['production'],
        createdAt: now,
        updatedAt: now,
        tags: ['maintenance', 'production']
      },
      {
        flagId: 'enhanced_logging',
        name: 'Enhanced Logging',
        description: 'Enable enhanced logging for production debugging',
        type: 'boolean',
        status: 'enabled',
        defaultValue: false,
        environments: ['production'],
        rules: [
          {
            id: 'enable_for_admin_users',
            name: 'Enable for Admin Users',
            description: 'Always enable enhanced logging for admin users',
            conditions: [
              ConditionBuilder.customAttribute('role', 'equals', 'admin')
            ],
            priority: 1,
            enabled: true,
            value: true
          }
        ],
        createdAt: now,
        updatedAt: now,
        tags: ['logging', 'production', 'debug']
      }
    ]
  };
}

/**
 * Create kill switch feature flags for emergency situations
 */
export function createKillSwitches(): {
  circuitBreaker: BooleanFlagConfig;
  rateLimiting: BooleanFlagConfig;
  fallbackMode: BooleanFlagConfig;
} {
  const now = Date.now();
  
  return {
    // Circuit breaker for external services
    circuitBreaker: {
      flagId: 'external_service_circuit_breaker',
      name: 'External Service Circuit Breaker',
      description: 'Enable circuit breaker for external service calls',
      type: 'boolean',
      status: 'enabled',
      defaultValue: true,
      rules: [
        {
          id: 'disable_on_high_error_rate',
          name: 'Disable on High Error Rate',
          description: 'Disable external calls if error rate is too high',
          conditions: [
            ConditionBuilder.customAttribute('error_rate', 'greater_than', 10)
          ],
          priority: 1,
          enabled: true,
          value: false
        }
      ],
      createdAt: now,
      updatedAt: now,
      tags: ['circuit-breaker', 'external', 'reliability']
    },

    // Rate limiting kill switch
    rateLimiting: {
      flagId: 'aggressive_rate_limiting',
      name: 'Aggressive Rate Limiting',
      description: 'Enable aggressive rate limiting during high load',
      type: 'boolean',
      status: 'enabled',
      defaultValue: false,
      rules: [
        {
          id: 'enable_during_high_load',
          name: 'Enable During High Load',
          description: 'Enable when system load is high',
          conditions: [
            ConditionBuilder.customAttribute('system_load', 'greater_than', 80)
          ],
          priority: 1,
          enabled: true,
          value: true
        }
      ],
      createdAt: now,
      updatedAt: now,
      tags: ['rate-limiting', 'load', 'protection']
    },

    // Fallback mode
    fallbackMode: {
      flagId: 'fallback_mode',
      name: 'Fallback Mode',
      description: 'Enable fallback mode for degraded functionality',
      type: 'boolean',
      status: 'enabled',
      defaultValue: false,
      createdAt: now,
      updatedAt: now,
      tags: ['fallback', 'degraded', 'emergency']
    }
  };
}

/**
 * Create performance optimization flags
 */
export function createPerformanceFlags(): {
  caching: BooleanFlagConfig;
  compression: BooleanFlagConfig;
  asyncProcessing: PercentageFlagConfig;
} {
  const now = Date.now();
  
  return {
    // Caching optimization
    caching: {
      flagId: 'advanced_caching',
      name: 'Advanced Caching',
      description: 'Enable advanced caching strategies',
      type: 'boolean',
      status: 'enabled',
      defaultValue: true,
      rules: [
        {
          id: 'disable_for_real_time_users',
          name: 'Disable for Real-time Users',
          description: 'Disable caching for users requiring real-time data',
          conditions: [
            ConditionBuilder.customAttribute('real_time', 'equals', true)
          ],
          priority: 1,
          enabled: true,
          value: false
        }
      ],
      createdAt: now,
      updatedAt: now,
      tags: ['caching', 'performance', 'optimization']
    },

    // Response compression
    compression: {
      flagId: 'response_compression',
      name: 'Response Compression',
      description: 'Enable response compression for large payloads',
      type: 'boolean',
      status: 'enabled',
      defaultValue: true,
      createdAt: now,
      updatedAt: now,
      tags: ['compression', 'performance', 'bandwidth']
    },

    // Async processing rollout
    asyncProcessing: {
      flagId: 'async_processing',
      name: 'Async Processing',
      description: 'Gradually roll out async processing for heavy operations',
      type: 'percentage',
      status: 'enabled',
      percentage: 25, // 25% of requests
      stickyUserId: true,
      createdAt: now,
      updatedAt: now,
      tags: ['async', 'performance', 'processing']
    }
  };
}