/**
 * Feature Flags Package - Main Export
 * High-performance feature flag system for AI orchestration platform
 */

// Core types
export * from './types';

// Core implementation
export { FeatureFlagManager } from './core/manager';
export { KVFlagStorage } from './core/kv-storage';

// Utilities
export * from './utils/hash';
export * from './utils/conditions';

// Middleware
export * from './middleware/hono';

// Admin interface
export { createAdminRouter } from './admin/router';
export type { AdminRouterConfig } from './admin/router';

// Factory functions for easy setup
export { createFeatureFlagSystem } from './factory';

// Quick start presets
export { createSimpleFlags, createCanaryFlags, createABTestFlags } from './presets';