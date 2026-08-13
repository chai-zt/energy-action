// ============================================================
// AI Core Lite 单元测试（无网络）
// - MiMo Provider（mock fetch）
// - Harness（fake provider）
// - task-decompose-v1 / minimum-action-v1（纯 validate）
// ============================================================

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

const { MiMoProvider, AiError, setProvider } = await import('../server/ai/providers/mimoProvider.ts')
const { runSkill } = await import('../server/ai/harness.ts')
const { taskDecomposeV1 } = await import('../server/ai/skills/taskDecomposeV1.ts')
const { minimumActionV1 } = await import('../server/ai/skills/minimumActionV1.ts')

const FAKE_KEY = 'test-key-123456789'

function jsonResponse(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ============================================================
// MiMo Provider
// ============================================================

describe('MiMo Provider', () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    process.env.MIMO_API_KEY = FAKE_KEY
    process.env.MIMO_BASE_URL = 'https://api.xiaomimimo.com/v1'
    process.env.MIMO_MODEL = 'mimo-v2.5'
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete process.env.MIMO_API_KEY
    delete process.env.MIMO_BASE_URL
    delete process.env.MIMO_MODEL
  })

  it('1. 正确 endpoint + Authorization header', async () => {
    let captured: { url: string; headers: Record<string, string>; body: Record<string, unknown> } | null = null
    globalThis.fetch = (async (url: any, opts: any) => {
      captured = { url: String(url), headers: opts.headers, body: JSON.parse(opts.body) }
      return jsonResponse('{"ok":1}')
    }) as typeof fetch

    await new MiMoProvider().generateJson({ systemPrompt: 's', userPrompt: 'u', maxTokens: 100 })
    assert.equal(captured!.url, 'https://api.xiaomimimo.com/v1/chat/completions')
    assert.equal(captured!.headers.Authorization, `Bearer ${FAKE_KEY}`)
  })

  it('2. 不输出 key（错误信息不含 key）', async () => {
    delete process.env.MIMO_API_KEY
    await assert.rejects(
      () => new MiMoProvider().generateJson({ systemPrompt: 's', userPrompt: 'u', maxTokens: 100 }),
      (err: AiError) => err.code === 'AI_CONFIG_ERROR' && !err.message.includes(FAKE_KEY),
    )
  })

  it('3. default model = mimo-v2.5', async () => {
    let body: Record<string, unknown> = {}
    globalThis.fetch = (async (_u: any, opts: any) => {
      body = JSON.parse(opts.body)
      return jsonResponse('{"ok":1}')
    }) as typeof fetch
    await new MiMoProvider().generateJson({ systemPrompt: 's', userPrompt: 'u', maxTokens: 100 })
    assert.equal(body.model, 'mimo-v2.5')
  })

  it('4. custom model', async () => {
    process.env.MIMO_MODEL = 'mimo-v2.5-pro'
    let body: Record<string, unknown> = {}
    globalThis.fetch = (async (_u: any, opts: any) => {
      body = JSON.parse(opts.body)
      return jsonResponse('{"ok":1}')
    }) as typeof fetch
    await new MiMoProvider().generateJson({ systemPrompt: 's', userPrompt: 'u', maxTokens: 100 })
    assert.equal(body.model, 'mimo-v2.5-pro')
  })

  it('5. custom base URL', async () => {
    process.env.MIMO_BASE_URL = 'https://custom.example.com/v1'
    let url = ''
    globalThis.fetch = (async (u: any, _opts: any) => {
      url = String(u)
      return jsonResponse('{"ok":1}')
    }) as typeof fetch
    await new MiMoProvider().generateJson({ systemPrompt: 's', userPrompt: 'u', maxTokens: 100 })
    assert.equal(url, 'https://custom.example.com/v1/chat/completions')
  })

  it('6. JSON response 提取 assistant content', async () => {
    globalThis.fetch = (async () => jsonResponse('{"foo":"bar"}')) as typeof fetch
    const res = await new MiMoProvider().generateJson({ systemPrompt: 's', userPrompt: 'u', maxTokens: 100 })
    assert.equal(res.text, '{"foo":"bar"}')
  })

  it('7. 401 / 403 → AI_PROVIDER_ERROR', async () => {
    for (const status of [401, 403]) {
      globalThis.fetch = (async () => new Response('', { status })) as typeof fetch
      await assert.rejects(
        () => new MiMoProvider().generateJson({ systemPrompt: 's', userPrompt: 'u', maxTokens: 100 }),
        (err: AiError) => err.code === 'AI_PROVIDER_ERROR' && err.status === status,
      )
    }
  })

  it('8. 429 → AI_PROVIDER_ERROR', async () => {
    globalThis.fetch = (async () => new Response('', { status: 429 })) as typeof fetch
    await assert.rejects(
      () => new MiMoProvider().generateJson({ systemPrompt: 's', userPrompt: 'u', maxTokens: 100 }),
      (err: AiError) => err.code === 'AI_PROVIDER_ERROR' && err.status === 429,
    )
  })

  it('9. 5xx → AI_PROVIDER_ERROR', async () => {
    globalThis.fetch = (async () => new Response('', { status: 500 })) as typeof fetch
    await assert.rejects(
      () => new MiMoProvider().generateJson({ systemPrompt: 's', userPrompt: 'u', maxTokens: 100 }),
      (err: AiError) => err.code === 'AI_PROVIDER_ERROR' && err.status === 500,
    )
  })

  it('10. timeout → AI_TIMEOUT', async () => {
    globalThis.fetch = (async () => {
      const e: any = new Error('aborted')
      e.name = 'AbortError'
      throw e
    }) as typeof fetch
    await assert.rejects(
      () => new MiMoProvider().generateJson({ systemPrompt: 's', userPrompt: 'u', maxTokens: 100 }),
      (err: AiError) => err.code === 'AI_TIMEOUT',
    )
  })

  it('11. malformed provider response → AI_PROVIDER_ERROR', async () => {
    globalThis.fetch = (async () => jsonResponse('')) as typeof fetch
    await assert.rejects(
      () => new MiMoProvider().generateJson({ systemPrompt: 's', userPrompt: 'u', maxTokens: 100 }),
      (err: AiError) => err.code === 'AI_PROVIDER_ERROR',
    )
  })
})

// ============================================================
// Harness
// ============================================================

describe('Harness', () => {
  const skill = {
    id: 'test-skill',
    version: '1',
    maxTokens: 100,
    buildSystemPrompt: () => 'system',
    buildUserPrompt: (input: string) => input,
    validate: (value: unknown) => {
      if (!value || typeof value !== 'object' || (value as any).ok !== true) {
        throw new Error('validation failed: ok must be true')
      }
      return value as { ok: boolean }
    },
  }

  it('1. valid JSON → 返回结果', async () => {
    setProvider({ async generateJson() { return { text: '{"ok":true}' } } })
    const res = await runSkill(skill, 'input')
    assert.deepEqual(res, { ok: true })
  })

  it('2. invalid JSON → 重试后 AI_OUTPUT_INVALID', async () => {
    let calls = 0
    setProvider({ async generateJson() { calls += 1; return { text: 'not-json' } } })
    await assert.rejects(
      () => runSkill(skill, 'input'),
      (err: AiError) => err.code === 'AI_OUTPUT_INVALID',
    )
    assert.equal(calls, 2)
  })

  it('3. valid JSON / invalid schema → 重试后 AI_OUTPUT_INVALID', async () => {
    let calls = 0
    setProvider({ async generateJson() { calls += 1; return { text: '{"ok":false}' } } })
    await assert.rejects(
      () => runSkill(skill, 'input'),
      (err: AiError) => err.code === 'AI_OUTPUT_INVALID',
    )
    assert.equal(calls, 2)
  })

  it('4. retry once：第一次失败第二次成功', async () => {
    let calls = 0
    setProvider({
      async generateJson() {
        calls += 1
        return calls === 1 ? { text: 'bad' } : { text: '{"ok":true}' }
      },
    })
    const res = await runSkill(skill, 'input')
    assert.deepEqual(res, { ok: true })
    assert.equal(calls, 2)
  })

  it('5. second retry fails → AI_OUTPUT_INVALID（无无限重试）', async () => {
    let calls = 0
    setProvider({ async generateJson() { calls += 1; return { text: 'bad' } } })
    await assert.rejects(() => runSkill(skill, 'input'), (err: AiError) => err.code === 'AI_OUTPUT_INVALID')
    assert.equal(calls, 2)
  })

  it('6. provider error 透传（不重试）', async () => {
    let calls = 0
    setProvider({
      async generateJson() {
        calls += 1
        throw new AiError('AI_PROVIDER_ERROR', 'upstream down')
      },
    })
    await assert.rejects(() => runSkill(skill, 'input'), (err: AiError) => err.code === 'AI_PROVIDER_ERROR')
    assert.equal(calls, 1)
  })
})

// ============================================================
// task-decompose-v1
// ============================================================

describe('task-decompose-v1', () => {
  const input = { title: '写 README', description: '', estimatedMinutes: 30, cognitiveLoad: 'medium', energyDemand: 3 }

  it('valid：shouldDecompose true + 2~5 children', () => {
    const out = taskDecomposeV1.validate({
      shouldDecompose: true,
      children: [
        { title: '写简介', description: 'a', estimatedMinutes: 10 },
        { title: '写安装', description: 'b', estimatedMinutes: 10 },
      ],
    }, input)
    assert.equal(out.shouldDecompose, true)
    assert.equal(out.children.length, 2)
  })

  it('invalid：children 空但 shouldDecompose=true', () => {
    assert.throws(() => taskDecomposeV1.validate({ shouldDecompose: true, children: [] }, input))
  })

  it('invalid：6+ children', () => {
    const children = Array.from({ length: 6 }, (_, i) => ({ title: `t${i}`, description: '', estimatedMinutes: 5 }))
    assert.throws(() => taskDecomposeV1.validate({ shouldDecompose: true, children }, input))
  })

  it('invalid：missing title', () => {
    assert.throws(() => taskDecomposeV1.validate({ shouldDecompose: true, children: [{ description: '', estimatedMinutes: 5 }, { title: 'x', description: '', estimatedMinutes: 5 }] }, input))
  })

  it('invalid：estimatedMinutes negative', () => {
    assert.throws(() => taskDecomposeV1.validate({ shouldDecompose: true, children: [{ title: 'x', description: '', estimatedMinutes: -1 }, { title: 'y', description: '', estimatedMinutes: 5 }] }, input))
  })

  it('invalid：wrong type（children 非数组）', () => {
    assert.throws(() => taskDecomposeV1.validate({ shouldDecompose: true, children: 'nope' }, input))
  })
})

// ============================================================
// minimum-action-v1
// ============================================================

describe('minimum-action-v1', () => {
  const input = {
    tasks: [
      { taskRef: 'child-0', title: '写简介', description: '' },
      { taskRef: 'child-1', title: '写安装', description: '' },
    ],
    energyLevel: 'medium' as const,
  }

  it('valid：taskRef 匹配 + 1..10 分钟 + 1..5 难度', () => {
    const out = minimumActionV1.validate({
      actions: [
        { taskRef: 'child-0', description: '打开文件写一句话', estimatedMinutes: 3, difficulty: 1 },
        { taskRef: 'child-1', description: '确认启动命令', estimatedMinutes: 5, difficulty: 2 },
      ],
    }, input)
    assert.equal(out.actions.length, 2)
  })

  it('invalid：taskRef 不存在于 input', () => {
    assert.throws(() => minimumActionV1.validate({ actions: [{ taskRef: 'child-99', description: 'x', estimatedMinutes: 3, difficulty: 1 }] }, input))
  })

  it('invalid：actions 数量超过输入 tasks 数量', () => {
    assert.throws(() => minimumActionV1.validate({
      actions: [
        { taskRef: 'child-0', description: 'a', estimatedMinutes: 3, difficulty: 1 },
        { taskRef: 'child-1', description: 'b', estimatedMinutes: 3, difficulty: 1 },
        { taskRef: 'child-2', description: 'c', estimatedMinutes: 3, difficulty: 1 },
      ],
    }, input))
  })

  it('invalid：重复 taskRef', () => {
    assert.throws(() => minimumActionV1.validate({
      actions: [
        { taskRef: 'child-0', description: 'a', estimatedMinutes: 3, difficulty: 1 },
        { taskRef: 'child-0', description: 'b', estimatedMinutes: 3, difficulty: 1 },
      ],
    }, input))
  })

  it('invalid：estimatedMinutes 超出 1..10', () => {
    assert.throws(() => minimumActionV1.validate({ actions: [{ taskRef: 'child-0', description: 'a', estimatedMinutes: 11, difficulty: 1 }] }, input))
  })

  it('invalid：difficulty 超出 1..5', () => {
    assert.throws(() => minimumActionV1.validate({ actions: [{ taskRef: 'child-0', description: 'a', estimatedMinutes: 3, difficulty: 6 }] }, input))
  })
})
