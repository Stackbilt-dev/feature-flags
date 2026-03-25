# @stackbilt/feature-flags

High-performance feature flag system for Cloudflare Workers with <5ms evaluation latency, canary deployments, A/B testing, and tenant isolation.

## Quick Start

```bash
npm install @stackbilt/feature-flags
```

Add KV namespaces to your `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "FEATURE_FLAGS_KV"
id = "your-flags-kv-id"

[[kv_namespaces]]
binding = "FEATURE_FLAGS_CACHE"
id = "your-cache-kv-id"
```

### Basic Usage

```typescript
import { createProductionFeatureFlags, createFeatureFlagMiddleware } from '@stackbilt/feature-flags';
import { Hono } from 'hono';

const app = new Hono();

// Setup
const flagSystem = createProductionFeatureFlags(env);
app.use('*', createFeatureFlagMiddleware({ manager: flagSystem.manager }));

// Evaluate in routes
app.get('/api/data', async (c) => {
  const flags = c.get('featureFlags');
  const useNewFeature = await flags.isEnabled('new_feature');

  return c.json({
    data: useNewFeature ? getNewData() : getLegacyData()
  });
});
```

## Features

- **Boolean flags** — simple on/off toggles
- **Percentage rollouts** — gradual rollouts with consistent user assignment
- **Variant flags** — A/B/n testing with weighted variants
- **Canary deployments** — staged rollouts with automatic advancement
- **Tenant overrides** — per-tenant flag values
- **Rule engine** — target by tenant, user, IP, custom attributes, time windows
- **KV storage** — built for Cloudflare Workers KV
- **Hono middleware** — drop-in integration with route guards and variant routing
- **Admin API** — REST endpoints for flag management
- **Audit logging** — track all flag changes
- **Metrics** — evaluation counts, latency percentiles, variant distribution

## Canary Deployments

```typescript
import { createCanaryFlags } from '@stackbilt/feature-flags';

const { gradualRollout, canaryConfig } = createCanaryFlags();
await manager.createFlag(gradualRollout);

// Start at 5%, auto-advance through stages
await manager.startCanaryDeployment('gradual_rollout_feature', canaryConfig);

// Manual advance
await manager.updateCanaryDeployment('gradual_rollout_feature', { percentage: 25 });

// Emergency rollback
await manager.stopCanaryDeployment('gradual_rollout_feature');
```

## A/B Testing

```typescript
import { createABTestFlags } from '@stackbilt/feature-flags';

const { simpleAB, multiVariant } = createABTestFlags();
await manager.createFlag(simpleAB);

// Evaluate — returns consistent variant per user
const result = await manager.evaluate('simple_ab_test', {
  userId: 'user-123'
});
console.log(result.variant); // 'control' or 'variant_a'
console.log(result.value);   // { theme: 'default', buttonColor: 'blue' }
```

### Variant-based Routing (Hono)

```typescript
import { withVariant } from '@stackbilt/feature-flags';

app.get('/recommendations',
  withVariant('recommendation_algo', {
    control: controlHandler,
    ml_enhanced: mlHandler,
    personalized: personalizedHandler
  })
);
```

## Rules and Conditions

```typescript
import { ConditionBuilder } from '@stackbilt/feature-flags';

const flag = {
  flagId: 'premium_feature',
  name: 'Premium Feature',
  type: 'boolean' as const,
  status: 'enabled' as const,
  defaultValue: false,
  rules: [{
    id: 'premium_only',
    conditions: [
      ConditionBuilder.customAttribute('plan', 'equals', 'premium'),
      ConditionBuilder.tenantIn(['tenant-a', 'tenant-b'])
    ],
    priority: 1,
    enabled: true,
    value: true
  }]
};
```

### Available Condition Builders

| Builder | Description |
|---------|-------------|
| `tenantEquals(id)` | Match specific tenant |
| `tenantIn(ids)` | Match any of listed tenants |
| `userEquals(id)` | Match specific user |
| `customAttribute(key, op, value)` | Match custom attribute |
| `ipStartsWith(prefix)` | Match IP prefix |
| `userAgentContains(str)` | Match user agent substring |
| `timeAfter(timestamp)` | After timestamp |
| `timeBefore(timestamp)` | Before timestamp |

### Comparison Operators

`equals`, `not_equals`, `in`, `not_in`, `contains`, `not_contains`, `starts_with`, `ends_with`, `greater_than`, `greater_than_or_equal`, `less_than`, `less_than_or_equal`, `matches_regex`, `exists`, `not_exists`

## Hono Middleware

```typescript
import {
  createFeatureFlagMiddleware,
  requireFlag,
  withFlag,
  checkFlag
} from '@stackbilt/feature-flags';

// Global middleware — attaches flag client to context
app.use('*', createFeatureFlagMiddleware({ manager }));

// Route guard — 404 if flag is off
app.get('/beta/*', requireFlag('beta_access'), handler);

// Conditional handler
app.get('/api/data', withFlag('use_new_api', newHandler, legacyHandler));

// Manual check
app.get('/api/status', async (c) => {
  const enabled = await checkFlag(c, 'enhanced_status');
  // ...
});
```

## Admin API

```typescript
import { createAdminRouter } from '@stackbilt/feature-flags';

const admin = createAdminRouter({
  manager,
  corsHeaders: true,
  authMiddleware: myAuthMiddleware
});

app.route('/admin/flags', admin);
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/flags` | List all flags |
| `POST` | `/flags` | Create flag |
| `GET` | `/flags/:id` | Get flag |
| `PUT` | `/flags/:id` | Update flag |
| `DELETE` | `/flags/:id` | Delete flag |
| `POST` | `/flags/:id/evaluate` | Test evaluation |
| `POST` | `/flags/:id/canary` | Start canary |
| `POST` | `/flags/:id/canary/advance` | Advance canary % |
| `POST` | `/flags/:id/canary/rollback` | Rollback canary |
| `GET` | `/flags/:id/metrics` | Get metrics |
| `GET` | `/audit` | Get audit logs |

## Factory Functions

| Function | Description |
|----------|-------------|
| `createFeatureFlagSystem(config)` | Full setup with custom config |
| `createProductionFeatureFlags(env)` | Production defaults (5min cache, 2s timeout) |
| `createDevelopmentFeatureFlags(env)` | Dev defaults (1min cache, 10s timeout) |
| `createLightweightFeatureFlags(env)` | No cache, no metrics |
| `createTestFeatureFlags()` | In-memory mock for tests |

## Testing

```typescript
import { createTestFeatureFlags } from '@stackbilt/feature-flags';

const system = createTestFeatureFlags();

await system.manager.createFlag({
  flagId: 'test_feature',
  name: 'Test',
  type: 'boolean',
  status: 'enabled',
  defaultValue: true
});

const result = await system.manager.evaluateBoolean('test_feature', {
  tenantId: 'test'
});
// result === true
```

## Presets

```typescript
import {
  createSimpleFlags,
  createCanaryFlags,
  createABTestFlags,
  createKillSwitches,
  createPerformanceFlags,
  createEnvironmentFlags
} from '@stackbilt/feature-flags';
```

## License

Apache-2.0
