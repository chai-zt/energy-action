import assert from 'node:assert/strict'
import test from 'node:test'
import { getActionCoins, getRewardPoints } from '../src/services/rewardService.ts'

const record = (overrides = {}) => ({
  id: 'r1',
  taskId: 't1',
  completedDate: '2026-08-15',
  completedAt: '2026-08-15T08:00:00.000Z',
  status: 'completed',
  energyCostSnapshot: 3,
  taskTitleSnapshot: '习惯',
  projectIdSnapshot: null,
  createdAt: '2026-08-15T08:00:00.000Z',
  ...overrides,
})

test('uses one point for legacy completed records', () => {
  assert.equal(getRewardPoints(record()), 1)
})

test('sums completed rewards and ignores skipped records', () => {
  assert.equal(getActionCoins([
    record({ rewardPoints: 1 }),
    record({ id: 'r2', rewardPoints: 2 }),
    record({ id: 'r3', status: 'skipped', rewardPoints: 10 }),
  ]), 3)
})
