import type { CompletionRecord } from '@/domain/models'

/** 旧完成记录没有 rewardPoints，按第一版规则兼容为一次行动。 */
export function getRewardPoints(record: CompletionRecord): number {
  return record.status === 'completed' ? (record.rewardPoints ?? 1) : 0
}

export function getActionCoins(records: CompletionRecord[]): number {
  return records.reduce((total, record) => total + getRewardPoints(record), 0)
}
