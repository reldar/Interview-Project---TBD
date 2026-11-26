import { AppError, ERROR_CODES } from './contracts.js';
import { createGeminiProvider } from './ats.js';

export const DEFAULT_AI_BUDGET = Object.freeze({ perMinute: 10, perDay: 60 });

export function getAiBudgetLimits(env = process.env) {
  const readLimit = (name, fallback) => {
    if (env[name] === undefined) return fallback;
    const value = Number(env[name]);
    if (!/^\d+$/.test(env[name]) || !Number.isSafeInteger(value)) {
      throw new AppError(ERROR_CODES.TEMPORARILY_UNAVAILABLE);
    }
    return value;
  };
  return {
    perMinute: readLimit('AI_UPSTREAM_REQUESTS_PER_MINUTE', DEFAULT_AI_BUDGET.perMinute),
    perDay: readLimit('AI_UPSTREAM_REQUESTS_PER_DAY', DEFAULT_AI_BUDGET.perDay),
  };
}

export async function requireAiBudget(store, limits, consume = false, ownership) {
  const budget = await store.useAiBudget(limits, consume, ownership);
  if (!budget.allowed) {
    throw new AppError(ERROR_CODES.QUOTA_REACHED, { action: 'aiBudget', resetAt: budget.resetAt });
  }
}

export function budgetedGeminiProvider(store, limits, ownership, opts = {}, onAttempt) {
  return createGeminiProvider({
    ...opts,
    maxAttempts: 3,
    beforeAttempt: async () => {
      await requireAiBudget(store, limits, true, ownership);
      onAttempt?.();
    },
  });
}
