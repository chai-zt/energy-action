// ============================================================
// AIAssistantFab — 全局 AI 助手浮动入口
// ============================================================

import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { Sparkles, X, Send, Mic, Minimize2 } from 'lucide-react'
import { aiProvider, type AIContext, type AIQuickAction } from '@/services/aiProvider'
import { cn, today } from '@/lib/utils'

const FAB_POSITION_KEY = 'ai_fab_position'
const CHAT_HISTORY_KEY = 'ai_chat_history'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export function AIAssistantFab() {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    const saved = localStorage.getItem(FAB_POSITION_KEY)
    if (saved) {
      try { return JSON.parse(saved) } catch { /* ignore */ }
    }
    return { x: 0, y: 0 }  // 0,0 = default bottom-right
  })
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = localStorage.getItem(CHAT_HISTORY_KEY)
    if (saved) {
      try { return JSON.parse(saved) } catch { return [] }
    }
    return []
  })
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const fabRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // 持久化位置
  useEffect(() => {
    localStorage.setItem(FAB_POSITION_KEY, JSON.stringify(position))
  }, [position])

  // 持久化对话
  useEffect(() => {
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(messages.slice(-50)))
  }, [messages])

  // 滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, open])

  // 拖拽
  const handleDragStart = (e: React.MouseEvent) => {
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: position.x,
      origY: position.y,
    }
  }

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!dragRef.current) return
      const dx = e.clientX - dragRef.current.startX
      const dy = e.clientY - dragRef.current.startY
      setPosition({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy })
    }
    const handleUp = () => { dragRef.current = null }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [])

  // 根据当前页面生成上下文
  const getContext = (): AIContext => {
    const path = location.pathname
    const page = path.split('/')[1] || 'today'
    return { page, data: { selectedDate: new Date().toISOString().split('T')[0] } }
  }

  const handleSend = async (text?: string) => {
    const msg = (text || input).trim()
    if (!msg || sending) return
    setInput('')
    setSending(true)

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: msg,
      timestamp: Date.now(),
    }
    setMessages(prev => [...prev, userMsg])

    try {
      const context = getContext()
      const reply = await aiProvider.chat(msg, context)
      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: reply,
        timestamp: Date.now(),
      }
      setMessages(prev => [...prev, assistantMsg])
    } catch (e) {
      setMessages(prev => [...prev, {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: '处理失败：' + String(e),
        timestamp: Date.now(),
      }])
    } finally {
      setSending(false)
    }
  }

  const handleQuickAction = async (action: AIQuickAction) => {
    if (action.id === 'start-review') {
      window.location.href = '/reviews'
      return
    }
    if (action.id === 'plan-today') {
      const plan = await aiProvider.generateDailyPlan()
      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: plan,
        timestamp: Date.now(),
      }
      setMessages(prev => [...prev, assistantMsg])
      return
    }
    if (action.id === 'top-3') {
      const plan = await aiProvider.generateDailyPlan()
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: '今天应该先做什么？',
        timestamp: Date.now(),
      }
      setMessages(prev => [...prev, userMsg, {
        id: `assistant-${Date.now() + 1}`,
        role: 'assistant',
        content: plan,
        timestamp: Date.now() + 1,
      }])
      return
    }
    if (action.id === 'summarize-today') {
      const summary = await aiProvider.summarizeDay(today())
      setMessages(prev => [...prev, {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: summary,
        timestamp: Date.now(),
      }])
      return
    }
    if (action.id === 'view-today') {
      const summary = await aiProvider.summarizeDay(today())
      setMessages(prev => [...prev, {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: summary,
        timestamp: Date.now(),
      }])
      return
    }
    if (action.id === 'analyze-tasks') {
      const summary = await aiProvider.chat('分析当前任务', getContext())
      setMessages(prev => [...prev, {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: summary,
        timestamp: Date.now(),
      }])
      return
    }
    if (action.id === 'goal-progress') {
      setMessages(prev => [...prev, {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: '请前往目标页面查看进度。',
        timestamp: Date.now(),
      }])
      return
    }
    if (action.id === 'create-task') {
      window.location.href = '/tasks'
      return
    }
    handleSend(action.label)
  }

  const positionStyle = {
    right: position.x === 0 ? undefined : `calc(1.5rem - ${position.x}px)`,
    bottom: position.y === 0 ? undefined : `calc(1.5rem - ${position.y}px)`,
  }

  return (
    <>
      {/* 浮动按钮 */}
      <div
        ref={fabRef}
        style={positionStyle}
        className="fixed z-40"
      >
        {!open && (
          <button
            onMouseDown={handleDragStart}
            onClick={(e) => {
              if (dragRef.current) return
              setOpen(true)
            }}
            className="w-12 h-12 rounded-full bg-blue-500 text-white shadow-lg hover:bg-blue-600 transition-colors flex items-center justify-center select-none cursor-grab active:cursor-grabbing"
            title="AI 助手"
          >
            <Sparkles size={20} />
          </button>
        )}
      </div>

      {/* 助手抽屉 */}
      {open && (
        <div className="fixed inset-y-0 right-0 w-80 max-w-full bg-white shadow-2xl z-50 flex flex-col border-l border-slate-200">
          {/* Header */}
          <div className="flex items-center justify-between p-3 border-b border-slate-200 bg-gradient-to-r from-blue-500 to-blue-600 text-white">
            <div className="flex items-center gap-2">
              <Sparkles size={18} />
              <div>
                <h3 className="font-semibold text-sm">AI 助手</h3>
                <p className="text-[10px] opacity-80">{aiProvider.name}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded hover:bg-white/20"
                title="收起"
              >
                <Minimize2 size={14} />
              </button>
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded hover:bg-white/20"
                title="关闭"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* 上下文 */}
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 text-[10px] text-slate-500">
            当前页面：{location.pathname}
          </div>

          {/* 消息列表 */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-3 space-y-2"
          >
            {messages.length === 0 && (
              <div className="text-center py-6 text-xs text-slate-400">
                <Sparkles size={24} className="mx-auto mb-2 text-slate-300" />
                <p className="mb-3">我可以基于本地数据帮你快速回答问题</p>
                <p>试试下方的快捷操作</p>
              </div>
            )}
            {messages.map(m => (
              <div
                key={m.id}
                className={cn(
                  'p-2 rounded-lg text-xs max-w-[90%]',
                  m.role === 'user'
                    ? 'bg-blue-500 text-white ml-auto'
                    : 'bg-slate-100 text-slate-700'
                )}
              >
                <p className="whitespace-pre-wrap break-words">{m.content}</p>
              </div>
            ))}
            {sending && (
              <div className="bg-slate-100 p-2 rounded-lg text-xs text-slate-500 max-w-[90%]">
                <span className="inline-flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </span>
              </div>
            )}
          </div>

          {/* 快捷操作 */}
          {messages.length === 0 && (
            <div className="px-3 py-2 border-t border-slate-100 max-h-[30vh] overflow-y-auto">
              <p className="text-[10px] text-slate-400 mb-2">快捷操作</p>
              <div className="grid grid-cols-2 gap-1.5">
                {aiProvider.quickActions.map(a => (
                  <button
                    key={a.id}
                    onClick={() => handleQuickAction(a)}
                    className="text-[10px] px-2 py-1.5 rounded bg-slate-50 hover:bg-blue-50 text-slate-600 hover:text-blue-700 text-left transition-colors"
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 输入框 */}
          <div className="p-3 border-t border-slate-200">
            <div className="flex items-center gap-1.5">
              <input
                className="input text-sm flex-1"
                placeholder="输入消息..."
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSend()}
                disabled={sending}
              />
              <button
                className="p-2 rounded hover:bg-slate-100 text-slate-400"
                title="语音输入（暂未启用）"
              >
                <Mic size={14} />
              </button>
              <button
                onClick={() => handleSend()}
                disabled={sending || !input.trim()}
                className="p-2 rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
                title="发送"
              >
                <Send size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
