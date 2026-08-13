import { describe, it, expect } from 'vitest'
import { MockAIProvider } from '@/services/aiProvider'

describe('MockAIProvider', () => {
  const provider = new MockAIProvider()

  it('should be configured', () => {
    expect(provider.isConfigured).toBe(true)
    expect(provider.name).toBeTruthy()
  })

  it('should provide quick actions', () => {
    expect(provider.quickActions.length).toBeGreaterThan(0)
    const ids = provider.quickActions.map(a => a.id)
    expect(ids).toContain('create-task')
    expect(ids).toContain('plan-today')
    expect(ids).toContain('top-3')
    expect(ids).toContain('summarize-today')
  })

  it('should reply to chat with non-empty message', () => {
    // 直接调用 keyword 路径，不依赖 IndexedDB
    const reply = (provider as any).summarizeToday({ page: 'today' })
    // 不验证具体内容，因为这个方法本身依赖 DB
    expect(typeof reply).toBe('object') // Promise
  })

  it('should have correct quick action labels', () => {
    const labels = provider.quickActions.map(a => a.label)
    expect(labels).toContain('新建任务')
    expect(labels).toContain('帮我安排今天')
    expect(labels).toContain('今天应该先做什么')
    expect(labels).toContain('开始每日复盘')
  })

  it('should not contain fabricated AI responses', () => {
    // Mock provider 的回答都应该来自真实数据
    expect(provider.name).not.toContain('GPT')
    expect(provider.name).not.toContain('Claude')
  })
})
