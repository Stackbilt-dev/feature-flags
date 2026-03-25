/**
 * Condition evaluation utilities for feature flag rules
 */

import type { Condition, ComparisonOperator, EvaluationContext } from '../types';

/**
 * Extract value from evaluation context using dot notation
 * e.g., 'customAttributes.plan' -> context.customAttributes?.plan
 */
export function extractContextValue(
  context: EvaluationContext,
  attribute: string
): any {
  const parts = attribute.split('.');
  let value: any = context;

  for (const part of parts) {
    if (value === null || value === undefined) {
      return undefined;
    }
    value = value[part];
  }

  return value;
}

/**
 * Evaluate a single condition against the context
 */
export function evaluateCondition(
  condition: Condition,
  context: EvaluationContext
): boolean {
  const contextValue = extractContextValue(context, condition.attribute);
  const result = compareValues(contextValue, condition.operator, condition.value);
  
  return condition.negate ? !result : result;
}

/**
 * Compare two values using the specified operator
 */
export function compareValues(
  contextValue: any,
  operator: ComparisonOperator,
  conditionValue: any
): boolean {
  switch (operator) {
    case 'equals':
      return contextValue === conditionValue;
    
    case 'not_equals':
      return contextValue !== conditionValue;
    
    case 'in':
      return Array.isArray(conditionValue) && conditionValue.includes(contextValue);
    
    case 'not_in':
      return Array.isArray(conditionValue) && !conditionValue.includes(contextValue);
    
    case 'contains':
      return typeof contextValue === 'string' && 
             typeof conditionValue === 'string' &&
             contextValue.includes(conditionValue);
    
    case 'not_contains':
      return typeof contextValue === 'string' && 
             typeof conditionValue === 'string' &&
             !contextValue.includes(conditionValue);
    
    case 'starts_with':
      return typeof contextValue === 'string' && 
             typeof conditionValue === 'string' &&
             contextValue.startsWith(conditionValue);
    
    case 'ends_with':
      return typeof contextValue === 'string' && 
             typeof conditionValue === 'string' &&
             contextValue.endsWith(conditionValue);
    
    case 'greater_than':
      return typeof contextValue === 'number' && 
             typeof conditionValue === 'number' &&
             contextValue > conditionValue;
    
    case 'greater_than_or_equal':
      return typeof contextValue === 'number' && 
             typeof conditionValue === 'number' &&
             contextValue >= conditionValue;
    
    case 'less_than':
      return typeof contextValue === 'number' && 
             typeof conditionValue === 'number' &&
             contextValue < conditionValue;
    
    case 'less_than_or_equal':
      return typeof contextValue === 'number' && 
             typeof conditionValue === 'number' &&
             contextValue <= conditionValue;
    
    case 'matches_regex':
      try {
        return typeof contextValue === 'string' && 
               typeof conditionValue === 'string' &&
               new RegExp(conditionValue).test(contextValue);
      } catch (error) {
        // Invalid regex - return false
        return false;
      }
    
    case 'exists':
      return contextValue !== undefined && contextValue !== null;
    
    case 'not_exists':
      return contextValue === undefined || contextValue === null;
    
    default:
      // Unknown operator
      return false;
  }
}

/**
 * Evaluate all conditions in a rule (AND logic)
 * Returns true if all conditions match
 */
export function evaluateAllConditions(
  conditions: Condition[],
  context: EvaluationContext
): { matches: boolean; matchedConditions: string[] } {
  const matchedConditions: string[] = [];
  
  for (const condition of conditions) {
    const matches = evaluateCondition(condition, context);
    if (matches) {
      matchedConditions.push(condition.attribute);
    } else {
      // AND logic - if any condition fails, the whole rule fails
      return { matches: false, matchedConditions: [] };
    }
  }
  
  return { matches: true, matchedConditions };
}

/**
 * Check if a rule is currently active based on time constraints
 */
export function isRuleActive(rule: {
  enabled: boolean;
  startTime?: number;
  endTime?: number;
}): boolean {
  if (!rule.enabled) {
    return false;
  }

  const now = Date.now();
  
  if (rule.startTime && now < rule.startTime) {
    return false;
  }
  
  if (rule.endTime && now > rule.endTime) {
    return false;
  }
  
  return true;
}

/**
 * Validate a condition object
 */
export function validateCondition(condition: Condition): string[] {
  const errors: string[] = [];
  
  if (!condition.attribute || typeof condition.attribute !== 'string') {
    errors.push('Condition attribute must be a non-empty string');
  }
  
  if (!condition.operator) {
    errors.push('Condition operator is required');
  }
  
  const validOperators: ComparisonOperator[] = [
    'equals', 'not_equals', 'in', 'not_in', 'contains', 'not_contains',
    'starts_with', 'ends_with', 'greater_than', 'greater_than_or_equal',
    'less_than', 'less_than_or_equal', 'matches_regex', 'exists', 'not_exists'
  ];
  
  if (!validOperators.includes(condition.operator)) {
    errors.push(`Invalid operator: ${condition.operator}`);
  }
  
  // Validate value based on operator
  if (['in', 'not_in'].includes(condition.operator)) {
    if (!Array.isArray(condition.value)) {
      errors.push(`Operator ${condition.operator} requires an array value`);
    }
  }
  
  if (['greater_than', 'greater_than_or_equal', 'less_than', 'less_than_or_equal'].includes(condition.operator)) {
    if (typeof condition.value !== 'number') {
      errors.push(`Operator ${condition.operator} requires a number value`);
    }
  }
  
  if (['contains', 'not_contains', 'starts_with', 'ends_with', 'matches_regex'].includes(condition.operator)) {
    if (typeof condition.value !== 'string') {
      errors.push(`Operator ${condition.operator} requires a string value`);
    }
  }
  
  if (condition.operator === 'matches_regex') {
    try {
      new RegExp(condition.value as string);
    } catch (error) {
      errors.push('Invalid regular expression in condition value');
    }
  }
  
  return errors;
}

/**
 * Create a human-readable description of a condition
 */
export function describeCondition(condition: Condition): string {
  const negation = condition.negate ? 'NOT ' : '';
  const attribute = condition.attribute;
  const operator = condition.operator.replace(/_/g, ' ');
  const value = Array.isArray(condition.value) 
    ? `[${condition.value.join(', ')}]`
    : condition.value;
  
  return `${negation}${attribute} ${operator} ${value}`;
}

/**
 * Create common condition builders for easy rule creation
 */
export const ConditionBuilder = {
  tenantEquals: (tenantId: string): Condition => ({
    attribute: 'tenantId',
    operator: 'equals',
    value: tenantId
  }),
  
  tenantIn: (tenantIds: string[]): Condition => ({
    attribute: 'tenantId',
    operator: 'in',
    value: tenantIds
  }),
  
  userEquals: (userId: string): Condition => ({
    attribute: 'userId',
    operator: 'equals',
    value: userId
  }),
  
  customAttribute: (key: string, operator: ComparisonOperator, value: any): Condition => ({
    attribute: `customAttributes.${key}`,
    operator,
    value
  }),
  
  ipStartsWith: (prefix: string): Condition => ({
    attribute: 'ip',
    operator: 'starts_with',
    value: prefix
  }),
  
  userAgentContains: (substring: string): Condition => ({
    attribute: 'userAgent',
    operator: 'contains',
    value: substring
  }),
  
  timeAfter: (timestamp: number): Condition => ({
    attribute: 'timestamp',
    operator: 'greater_than_or_equal',
    value: timestamp
  }),
  
  timeBefore: (timestamp: number): Condition => ({
    attribute: 'timestamp',
    operator: 'less_than_or_equal',
    value: timestamp
  })
};

/**
 * Precompile conditions for faster evaluation
 * Returns optimized evaluation functions
 */
export function compileConditions(conditions: Condition[]): (context: EvaluationContext) => boolean {
  // Pre-validate conditions
  for (const condition of conditions) {
    const errors = validateCondition(condition);
    if (errors.length > 0) {
      throw new Error(`Invalid condition: ${errors.join(', ')}`);
    }
  }
  
  // Return optimized evaluation function
  return (context: EvaluationContext): boolean => {
    for (const condition of conditions) {
      if (!evaluateCondition(condition, context)) {
        return false;
      }
    }
    return true;
  };
}