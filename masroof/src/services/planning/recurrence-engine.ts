import type { DataDeps } from '@/data/database';
import type { Repositories } from '@/data/repositories';
import { withUnitOfWork } from '@/data/unit-of-work';
import {
  AUTO_POST_REVIEW_THRESHOLD,
  nextOccurrenceAfter,
  occurrencesBetween,
  type LocalDate,
} from '@/domain';

export type EngineSummary = Readonly<{
  /** Occurrences posted directly (auto_post, ≤ 3 due). */
  posted: number;
  /** Occurrences waiting in the Upcoming inbox (confirm, remind, or > 3 auto_post). */
  pending: number;
  /** auto_post rules whose back-fill exceeded the threshold and went to review (J5). */
  reviewRuleIds: string[];
  /** Rules that could not post (archived account/category, missing rate…). */
  failedRuleIds: string[];
}>;

export const MAX_PER_RULE_PER_RUN = 1000;

class RuleFailed extends Error {
  constructor(readonly reason: string) {
    super('rule failed');
  }
}

/**
 * Generate every due occurrence up to `today` (ADR-013). Safe to run any
 * number of times, concurrently, or with the clock moved backwards: the
 * cursor only moves forward and the recurrence key is UNIQUE.
 */
export function runRecurrenceEngine(
  deps: DataDeps & { repos: Repositories },
  today: LocalDate,
): EngineSummary {
  const { repos } = deps;
  let posted = 0;
  let pending = 0;
  const reviewRuleIds: string[] = [];
  const failedRuleIds: string[] = [];

  for (const rule of repos.recurring.list().rules) {
    if (rule.isPaused || !rule.nextOn || rule.nextOn > today) continue;
    const dates = occurrencesBetween(rule.schedule, rule.nextOn, today, {
      alreadyGenerated: rule.occurrenceCount,
      limit: MAX_PER_RULE_PER_RUN,
    });
    const last = dates[dates.length - 1];
    if (!last) {
      // Ended (end date / count) since the cursor was set.
      withUnitOfWork(deps, (uow) =>
        repos.recurring.advance(rule.id, { nextOn: null, generated: 0, at: uow.now }),
      );
      continue;
    }
    const review = rule.mode === 'auto_post' && dates.length > AUTO_POST_REVIEW_THRESHOLD;
    const status = rule.mode === 'auto_post' && !review ? 'posted' : 'pending_recurring';
    try {
      withUnitOfWork(deps, (uow) => {
        for (const date of dates) {
          const r = repos.transactions.createOccurrence({
            ruleId: rule.id,
            date,
            timeZone: rule.timeZone,
            template: rule.template,
            status,
          });
          // Throwing rolls back every occurrence of this rule from this run.
          if (!r.ok) throw new RuleFailed(r.error.join(','));
        }
        const generated = rule.occurrenceCount + dates.length;
        repos.recurring.advance(rule.id, {
          nextOn: nextOccurrenceAfter(rule.schedule, last, generated),
          generated: dates.length,
          at: uow.now,
        });
      });
      if (status === 'posted') posted += dates.length;
      else pending += dates.length;
      if (review) reviewRuleIds.push(rule.id);
    } catch (e) {
      failedRuleIds.push(rule.id);
      // Only a validation failure is the rule's fault; anything else (busy DB) just retries next run.
      if (e instanceof RuleFailed) repos.recurring.setError(rule.id, e.reason);
    }
  }
  return { posted, pending, reviewRuleIds, failedRuleIds };
}
