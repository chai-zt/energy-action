import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Play, Pause, SkipForward, RotateCcw, Timer, Coffee, Brain, ChevronRight, Plus } from 'lucide-react'
import { DexieTaskRepository, DexiePomodoroRepository, DexieTimeRecordRepository, DexieSettingsRepository } from '@/storage/repositories'
import { generateId, now, today } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { Task, PomodoroSession, TimeRecord, AppSettings } from '@/domain/models'

// localStorage key for timer persistence
const TIMER_STATE_KEY = 'pomodoro_timer_state'

interface TimerState {
  taskId: string | null
  taskTitle: string
  type: 'work' | 'short_break' | 'long_break'
  startTime: number
  totalSeconds: number
  elapsedSeconds: number
  pomodoroCount: number
  isRunning: boolean
}

const defaultSettings = {
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakInterval: 4,
}

export function TimerPage() {
  const [searchParams] = useSearchParams()
  const taskIdFromUrl = searchParams.get('taskId')

  const [settings, setSettings] = useState(defaultSettings)
  const [task, setTask] = useState<Task | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [timerState, setTimerState] = useState<TimerState>(() => {
    // 恢复上次计时器状态
    const saved = localStorage.getItem(TIMER_STATE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved) as TimerState
      // 计算已经过的时间（考虑暂停的情况）
      if (parsed.isRunning) {
        const nowTime = Date.now()
        const additional = Math.floor((nowTime - parsed.startTime) / 1000)
        return { ...parsed, elapsedSeconds: parsed.elapsedSeconds + additional, startTime: nowTime }
      }
      return parsed
    }
    return {
      taskId: null,
      taskTitle: '',
      type: 'work',
      startTime: 0,
      totalSeconds: 25 * 60,
      elapsedSeconds: 0,
      pomodoroCount: 0,
      isRunning: false,
    }
  })

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 加载设置
  useEffect(() => {
    const loadSettings = async () => {
      const repo = new DexieSettingsRepository()
      const s = await repo.get()
      if (s) {
        setSettings({
          workMinutes: s.pomodoroWorkMinutes,
          shortBreakMinutes: s.pomodoroShortBreakMinutes,
          longBreakMinutes: s.pomodoroLongBreakMinutes,
          longBreakInterval: s.pomodoroLongBreakInterval,
        })
      }
    }
    loadSettings()
  }, [])

  // 加载任务
  useEffect(() => {
    const loadTasks = async () => {
      const repo = new DexieTaskRepository()
      const allTasks = await repo.getAll()
      setTasks(allTasks.filter(t => t.status !== 'done' && t.status !== 'cancelled' && !t.deletedAt))
      if (taskIdFromUrl || timerState.taskId) {
        const t = allTasks.find(t => t.id === (taskIdFromUrl || timerState.taskId))
        if (t) setTask(t)
      }
    }
    loadTasks()
  }, [taskIdFromUrl])

  // 持久化计时器状态
  useEffect(() => {
    localStorage.setItem(TIMER_STATE_KEY, JSON.stringify({
      ...timerState,
      startTime: timerState.isRunning ? Date.now() : timerState.startTime,
    }))
  }, [timerState])

  // 计时器逻辑
  useEffect(() => {
    if (timerState.isRunning) {
      timerRef.current = setInterval(() => {
        setTimerState(prev => {
          const newElapsed = prev.elapsedSeconds + 1
          if (newElapsed >= prev.totalSeconds) {
            // 计时完成
            clearInterval(timerRef.current!)
            handleTimerComplete(prev)
            return { ...prev, isRunning: false, elapsedSeconds: prev.totalSeconds }
          }
          return { ...prev, elapsedSeconds: newElapsed }
        })
      }, 1000)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [timerState.isRunning])

  const handleTimerComplete = async (state: TimerState) => {
    const pomodoroRepo = new DexiePomodoroRepository()

    // 记录番茄钟 session
    if (state.type === 'work') {
      const session: PomodoroSession = {
        id: generateId(),
        taskId: state.taskId,
        startAt: new Date(state.startTime).toISOString(),
        endAt: now(),
        durationMinutes: Math.round(state.totalSeconds / 60),
        type: 'work',
        completed: true,
        createdAt: now(),
      }
      await pomodoroRepo.create(session)

      // 更新时间记录
      if (state.taskId) {
        const timeRepo = new DexieTimeRecordRepository()
        const record: TimeRecord = {
          id: generateId(),
          taskId: state.taskId,
          projectId: null,
          startAt: new Date(state.startTime).toISOString(),
          endAt: now(),
          durationMinutes: Math.round(state.totalSeconds / 60),
          source: 'pomodoro',
          note: '',
          focusScore: null,
          interruptionCount: 0,
          createdAt: now(),
          deletedAt: null,
        }
        await timeRepo.create(record)

        // 更新任务实际时间
        const taskRepo = new DexieTaskRepository()
        const task = await taskRepo.getById(state.taskId)
        if (task) {
          await taskRepo.update(state.taskId, {
            actualMinutes: task.actualMinutes + Math.round(state.totalSeconds / 60),
          })
        }
      }

      // 系统通知
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('番茄钟完成!', { body: '工作时间结束，该休息了' })
      }
    }

    // 自动切换到下个阶段
    const newPomodoroCount = state.type === 'work' ? state.pomodoroCount + 1 : state.pomodoroCount
    let nextType: TimerState['type'] = 'work'
    let nextTotal = settings.workMinutes * 60

    if (state.type === 'work') {
      if (newPomodoroCount % settings.longBreakInterval === 0) {
        nextType = 'long_break'
        nextTotal = settings.longBreakMinutes * 60
      } else {
        nextType = 'short_break'
        nextTotal = settings.shortBreakMinutes * 60
      }
    }
    // break后自动开始新的work（需要用户手动开始）

    setTimerState({
      taskId: state.taskId,
      taskTitle: state.taskTitle,
      type: nextType,
      startTime: 0,
      totalSeconds: nextTotal,
      elapsedSeconds: 0,
      pomodoroCount: newPomodoroCount,
      isRunning: false,
    })
  }

  const startTimer = () => {
    if (Notification.permission === 'default') {
      Notification.requestPermission()
    }
    setTimerState(prev => ({
      ...prev,
      isRunning: true,
      startTime: Date.now() - prev.elapsedSeconds * 1000,
    }))
  }

  const pauseTimer = () => {
    setTimerState(prev => ({ ...prev, isRunning: false }))
  }

  const skipToNext = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    handleTimerComplete({
      ...timerState,
      elapsedSeconds: timerState.totalSeconds,
    })
  }

  const resetTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    setTimerState(prev => ({
      ...prev,
      isRunning: false,
      elapsedSeconds: 0,
    }))
  }

  const selectTask = (t: Task) => {
    setTask(t)
    const totalSec = settings.workMinutes * 60
    setTimerState({
      taskId: t.id,
      taskTitle: t.title,
      type: 'work',
      startTime: 0,
      totalSeconds: totalSec,
      elapsedSeconds: 0,
      pomodoroCount: timerState.pomodoroCount,
      isRunning: false,
    })
  }

  const remaining = timerState.totalSeconds - timerState.elapsedSeconds
  const minutes = Math.floor(remaining / 60)
  const seconds = remaining % 60
  const progress = (timerState.elapsedSeconds / timerState.totalSeconds) * 100

  const isWork = timerState.type === 'work'
  const themeColor = isWork ? '#ef4444' :
                     timerState.type === 'long_break' ? '#8b5cf6' : '#22c55e'

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Timer size={24} className="text-blue-500" />
        <h1 className="text-xl font-bold text-slate-800">番茄钟</h1>
      </div>

      {/* 计时器主体 */}
      <div className="card text-center py-8">
        {/* 任务名 */}
        {task ? (
          <p className="text-sm text-slate-500 mb-2">
            {task.title}
            <button
              onClick={() => { setTask(null); setTimerState(prev => ({ ...prev, taskId: null, taskTitle: '' })) }}
              className="ml-2 text-slate-300 hover:text-slate-500 text-xs"
            >
              取消关联
            </button>
          </p>
        ) : (
          <p className="text-sm text-slate-400 mb-2">未关联任务（快速模式）</p>
        )}

        {/* 计时器圆环 */}
        <div className="relative w-48 h-48 mx-auto my-4">
          <svg viewBox="0 0 200 200" className="w-full h-full -rotate-90">
            <circle cx="100" cy="100" r="90" fill="none" stroke="#e2e8f0" strokeWidth="8" />
            <circle
              cx="100" cy="100" r="90" fill="none" stroke={themeColor}
              strokeWidth="8" strokeLinecap="round"
              strokeDasharray={`${progress * 5.655} 565.5`}
              style={{ transition: 'stroke-dasharray 0.5s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={cn(
              'text-4xl font-mono font-bold tabular-nums',
              isWork ? 'text-red-500' : 'text-green-500'
            )}>
              {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
            </span>
            <span className="text-sm text-slate-500 mt-1">
              {isWork ? '专注工作' : timerState.type === 'long_break' ? '长休息' : '短休息'}
            </span>
          </div>
        </div>

        {/* 控制按钮 */}
        <div className="flex items-center justify-center gap-3 mt-4">
          {!timerState.isRunning ? (
            <button
              onClick={startTimer}
              className="w-14 h-14 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors shadow-lg"
            >
              <Play size={24} className="ml-1" />
            </button>
          ) : (
            <button
              onClick={pauseTimer}
              className="w-14 h-14 rounded-full bg-amber-500 text-white flex items-center justify-center hover:bg-amber-600 transition-colors shadow-lg"
            >
              <Pause size={24} />
            </button>
          )}
          <button
            onClick={skipToNext}
            className="w-10 h-10 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center hover:bg-slate-200 transition-colors"
            title="跳过"
          >
            <SkipForward size={18} />
          </button>
          <button
            onClick={resetTimer}
            className="w-10 h-10 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center hover:bg-slate-200 transition-colors"
            title="重置"
          >
            <RotateCcw size={18} />
          </button>
        </div>

        {/* 进度信息 */}
        <div className="mt-4 text-xs text-slate-500">
          已完成 {timerState.pomodoroCount} 个番茄
          {timerState.pomodoroCount > 0 && timerState.pomodoroCount % settings.longBreakInterval === 0 && (
            <span className="text-purple-500 ml-1">· 下个是长休息</span>
          )}
        </div>
      </div>

      {/* 关联任务列表 */}
      {!task && (
        <div className="card">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">选择任务开始番茄钟</h3>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {tasks.slice(0, 10).map(t => (
              <button
                key={t.id}
                onClick={() => selectTask(t)}
                className="w-full text-left p-2 rounded hover:bg-slate-50 flex items-center justify-between text-sm"
              >
                <span className="text-slate-700 truncate">{t.title}</span>
                <ChevronRight size={14} className="text-slate-300 flex-shrink-0" />
              </button>
            ))}
            {tasks.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-2">没有进行中的任务</p>
            )}
          </div>
        </div>
      )}

      {/* 番茄钟设置 */}
      <div className="card">
        <h2 className="font-semibold text-slate-800 mb-3">番茄钟设置</h2>
        <PomodoroPresets onPresetChange={(w, s, l, i) => {
          setSettings({ workMinutes: w, shortBreakMinutes: s, longBreakMinutes: l, longBreakInterval: i })
          // 未运行时立即同步倒计时
          if (!timerRef.current) {
            setTimerState(prev => ({ ...prev, totalSeconds: w * 60, elapsedSeconds: 0 }))
          }
        }} />
      </div>

      {/* 手动补录时间 */}
      <ManualTimeEntry onRecorded={() => {
        const load = async () => {
          const repo = new DexieTaskRepository()
          const allTasks = await repo.getAll()
          setTasks(allTasks.filter(t => t.status !== 'done' && t.status !== 'cancelled' && !t.deletedAt))
        }
        load()
      }} tasks={tasks} />
    </div>
  )
}

function ManualTimeEntry({
  tasks, onRecorded,
}: {
  tasks: Task[]
  onRecorded: () => void
}) {
  const [show, setShow] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState('')
  const [duration, setDuration] = useState(30)
  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState('')

  const handleSubmit = async () => {
    if (!selectedTaskId || duration <= 0) return
    try {
      const repo = new DexieTimeRecordRepository()
      const taskRepo = new DexieTaskRepository()
      await repo.create({
        id: generateId(),
        taskId: selectedTaskId,
        projectId: null,
        startAt: `${date}T12:00:00.000Z`,
        endAt: new Date(new Date(`${date}T12:00:00`).getTime() + duration * 60000).toISOString(),
        durationMinutes: duration,
        source: 'manual',
        note,
        focusScore: null,
        interruptionCount: 0,
        createdAt: now(),
        deletedAt: null,
      })
      const task = await taskRepo.getById(selectedTaskId)
      if (task) {
        await taskRepo.update(selectedTaskId, { actualMinutes: task.actualMinutes + duration })
      }
      setMsg('时间记录已保存')
      setTimeout(() => { setMsg(''); setShow(false); onRecorded() }, 1500)
    } catch (e) {
      setMsg('保存失败: ' + String(e))
    }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-slate-700">手动补录时间</h3>
        {!show && (
          <button onClick={() => setShow(true)} className="btn-ghost text-xs">
            <Plus size={14} className="mr-1 inline" /> 补录
          </button>
        )}
      </div>
      {show && (
        <div className="space-y-3">
          {msg && <p className="text-xs text-green-600">{msg}</p>}
          <div>
            <label className="label">关联任务</label>
            <select className="input text-sm" value={selectedTaskId} onChange={e => setSelectedTaskId(e.target.value)}>
              <option value="">选择任务</option>
              {tasks.map(t => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">时长（分钟）</label>
              <input type="number" className="input" value={duration} onChange={e => setDuration(Number(e.target.value))} min={1} />
            </div>
            <div>
              <label className="label">日期</label>
              <input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">备注</label>
            <input className="input text-sm" value={note} onChange={e => setNote(e.target.value)} placeholder="可选" />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShow(false)} className="btn-ghost text-xs">取消</button>
            <button onClick={handleSubmit} className="btn-primary text-xs" disabled={!selectedTaskId || duration <= 0}>保存</button>
          </div>
        </div>
      )}
    </div>
  )
}

function PomodoroPresets({ onPresetChange }: { onPresetChange: (work: number, short: number, long: number, interval: number) => void }) {
  const [presetId, setPresetId] = useState('standard')
  const [saved, setSaved] = useState(false)

  const presets = [
    { id: 'quick_start', name: '快速启动', work: 20, short: 5, long: 15, interval: 4, desc: '拖延时快速启动，精力较低时适用' },
    { id: 'standard', name: '标准专注', work: 25, short: 5, long: 15, interval: 4, desc: '日常通用默认方案' },
    { id: 'deep_focus', name: '持续专注', work: 50, short: 10, long: 25, interval: 3, desc: '阅读学习、写作、普通编码' },
    { id: 'flow', name: '心流深度', work: 90, short: 20, long: 30, interval: 2, desc: '复杂编程、架构设计、深度写作' },
  ]

  const handleSelect = async (id: string) => {
    setPresetId(id)
    const { db } = await import('@/storage/db')
    const preset = presets.find(p => p.id === id)
    await db.appSettings.put({
      id: 'default',
      pomodoroWorkMinutes: preset?.work || 25,
      pomodoroShortBreakMinutes: preset?.short || 5,
      pomodoroLongBreakMinutes: preset?.long || 15,
      pomodoroLongBreakInterval: preset?.interval || 4,
      lastCalendarView: 'week',
      quietHoursStart: null,
      quietHoursEnd: null,
      pomodoroPresetId: id,
      pomodoroCustomWork: 25,
      pomodoroCustomShortBreak: 5,
      pomodoroCustomLongBreak: 15,
      pomodoroCustomLongInterval: 4,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    onPresetChange(preset?.work || 25, preset?.short || 5, preset?.long || 15, preset?.interval || 4)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div>
      {saved && <p className="text-xs text-green-600 mb-2">已保存</p>}
      <div className="grid grid-cols-2 gap-2 mb-3">
        {presets.map(p => (
          <button
            key={p.id}
            onClick={() => handleSelect(p.id)}
            className={cn(
              'p-3 rounded-lg border text-left transition-all',
              presetId === p.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-blue-200'
            )}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-slate-700">{p.name}</span>
              {presetId === p.id && <span className="badge badge-success text-[9px]">当前</span>}
            </div>
            <p className="text-[10px] text-slate-500">{p.work}分专注 · {p.short}分短休 · {p.long}分长休 · 每{p.interval}轮</p>
            <p className="text-[10px] text-slate-400 mt-1">{p.desc}</p>
          </button>
        ))}
      </div>
      <p className="text-[10px] text-slate-400">切换预设方案后立即生效，正在运行的计时从下一轮开始应用新方案</p>
    </div>
  )
}
