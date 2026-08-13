// ============================================================
// AiModelConfigForm — 统一的 AI 模型配置表单
//
// 由「右上角轻量 Dialog」与「Settings 完整 Panel」共享。
// 只维护这一套逻辑，不复制两份。
// API Key 输入再次打开保持空白，只显示 maskedSecret。
// ============================================================

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Check, Trash2, PlugZap, AlertTriangle } from 'lucide-react'
import {
  getAiStatus, saveAiConfig, testAiConfig, deleteAiConfig,
  type AiStatus, type ProviderType, type CredentialType,
} from '@/services/aiConfigApi'
import { cn } from '@/lib/utils'

function categoryLabel(c?: string): string {
  switch (c) {
    case 'credential': return '凭据错误（Key 无效或无权限）'
    case 'network': return '网络错误（无法连接）'
    case 'provider': return '服务商错误'
    case 'model': return '模型不存在'
    case 'rate_limit': return '触发限流'
    case 'invalid_config': return '配置无效'
    default: return '未知错误'
  }
}

export interface AiModelConfigFormProps {
  /** 保存/删除/测试成功后回调（刷新全局状态）。 */
  onChanged?: () => void
  compact?: boolean
}

export function AiModelConfigForm({ onChanged, compact = false }: AiModelConfigFormProps) {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [providerType, setProviderType] = useState<ProviderType>('mimo')
  const [credentialType, setCredentialType] = useState<CredentialType>('pay_as_you_go')
  const [providerName, setProviderName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('mimo-v2.5')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'ok' | 'err'>('ok')

  const refresh = useCallback(async () => {
    try {
      const s = await getAiStatus()
      setStatus(s)
      if (s.providerType) setProviderType(s.providerType)
      if (s.credentialType) setCredentialType(s.credentialType)
      if (s.providerName) setProviderName(s.providerName)
      if (s.baseUrl) setBaseUrl(s.baseUrl)
      if (s.model) setModel(s.model)
    } catch {
      /* 后端未启动时静默 */
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const showMessage = (text: string, type: 'ok' | 'err') => {
    setMessage(text)
    setMessageType(type)
  }

  const handleSave = async () => {
    setBusy(true)
    try {
      await saveAiConfig({
        providerType, credentialType, providerName, baseUrl, model,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      })
      setApiKey('')
      await refresh()
      showMessage('已保存', 'ok')
      onChanged?.()
    } catch (e) {
      showMessage('保存失败：' + String(e), 'err')
    } finally {
      setBusy(false)
    }
  }

  const handleTest = async () => {
    setBusy(true)
    try {
      const r = await testAiConfig({
        providerType, credentialType, providerName, baseUrl, model,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      })
      if (r.ok) showMessage('连接验证成功', 'ok')
      else showMessage('连接失败：' + categoryLabel(r.category), 'err')
      await refresh()
      onChanged?.()
    } catch (e) {
      showMessage('测试失败：' + String(e), 'err')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    setBusy(true)
    try {
      await deleteAiConfig()
      setApiKey('')
      await refresh()
      showMessage('已清除模型配置', 'ok')
      onChanged?.()
    } catch (e) {
      showMessage('清除失败：' + String(e), 'err')
    } finally {
      setBusy(false)
    }
  }

  const inputCls = 'input text-sm w-full'
  const labelCls = 'text-xs font-medium text-slate-500 mb-1 block'

  return (
    <div className={cn('space-y-3', compact ? 'text-xs' : '')}>
      {/* 当前状态 */}
      {status && (
        <div className={cn(
          'rounded-lg px-3 py-2 text-xs flex items-center gap-2',
          status.fuseStatus === 'LOCKED' ? 'bg-red-50 text-red-700'
            : status.available ? 'bg-emerald-50 text-emerald-700'
            : 'bg-amber-50 text-amber-700',
        )}>
          {status.fuseStatus === 'LOCKED' ? <AlertTriangle size={14} />
            : status.available ? <Check size={14} /> : <PlugZap size={14} />}
          <span>
            {status.fuseStatus === 'LOCKED' ? 'AI 已锁定'
              : status.available ? `AI 已连接 · ${status.model || ''}`
              : status.configured ? 'AI 待验证'
              : 'AI 未配置'}
          </span>
        </div>
      )}

      {/* Provider 类型 */}
      <div>
        <label className={labelCls}>模型服务</label>
        <select className={inputCls} value={providerType} onChange={e => setProviderType(e.target.value as ProviderType)}>
          <option value="mimo">Xiaomi MiMo</option>
          <option value="openai_compatible">OpenAI 兼容服务（自定义）</option>
        </select>
      </div>

      {/* MiMo 凭据类型 */}
      {providerType === 'mimo' && (
        <div>
          <label className={labelCls}>凭据类型</label>
          <select className={inputCls} value={credentialType} onChange={e => setCredentialType(e.target.value as CredentialType)}>
            <option value="pay_as_you_go">按量付费（Pay-as-you-go）</option>
            <option value="token_plan">Token 套餐（自填 Base URL）</option>
          </select>
        </div>
      )}

      {/* OpenAI 兼容：Provider 名称 */}
      {providerType === 'openai_compatible' && (
        <div>
          <label className={labelCls}>服务名称</label>
          <input className={inputCls} value={providerName} onChange={e => setProviderName(e.target.value)} placeholder="例如：My Model Service" />
        </div>
      )}

      {/* Base URL */}
      <div>
        <label className={labelCls}>Base URL（仅 HTTPS）</label>
        <input
          className={inputCls}
          value={baseUrl}
          onChange={e => setBaseUrl(e.target.value)}
          placeholder={providerType === 'mimo' ? 'https://api.xiaomimimo.com/v1' : 'https://your-provider.example.com/v1'}
        />
      </div>

      {/* Model */}
      <div>
        <label className={labelCls}>模型</label>
        <input className={inputCls} value={model} onChange={e => setModel(e.target.value)} placeholder={providerType === 'mimo' ? 'mimo-v2.5' : 'model-name'} />
      </div>

      {/* API Key */}
      <div>
        <label className={labelCls}>API Key</label>
        <input
          type="password"
          className={inputCls}
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder={status?.maskedSecret ? `已安全保存：${status.maskedSecret}（留空保持不变）` : '输入 API Key'}
          autoComplete="off"
        />
        {status?.secretStoreMode === 'memory' && status.configured && (
          <p className="mt-1 text-[10px] text-amber-600 flex items-center gap-1">
            <AlertTriangle size={10} />
            系统安全凭据库不可用，本次 API Key 仅在当前运行期间有效，关闭应用后需要重新配置。
          </p>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" onClick={handleSave} disabled={busy} className="btn-primary flex items-center gap-1 text-xs">
          {busy ? <Loader2 size={14} className="animate-spin" /> : null} 保存
        </button>
        <button type="button" onClick={handleTest} disabled={busy} className="btn-secondary flex items-center gap-1 text-xs">
          <PlugZap size={14} /> 测试连接
        </button>
        {status?.configured && (
          <button type="button" onClick={handleDelete} disabled={busy} className="btn-danger flex items-center gap-1 text-xs">
            <Trash2 size={14} /> 清除
          </button>
        )}
      </div>

      {message && (
        <p className={cn('text-xs', messageType === 'ok' ? 'text-emerald-600' : 'text-red-600')}>{message}</p>
      )}
    </div>
  )
}
