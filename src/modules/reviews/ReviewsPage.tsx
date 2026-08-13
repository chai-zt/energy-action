import { useState, useEffect, useCallback } from 'react'
import { BookOpen, Calendar, Zap, Save, Download, Clock } from 'lucide-react'
import {
  DexieDailyStateRepository, DexieDailyReviewRepository,
  DexieTaskRepository, DexieTimeRecordRepository,
  DexieCompletionRepository,
} from '@/storage/repositories'
import { cn, generateId, now, today } from '@/lib/utils'
import { AutoGrowTextarea } from '@/components/AutoGrowTextarea'
import { UndoneTasksSelector } from '@/components/UndoneTasksSelector'
import { shouldExecuteOnDate } from '@/services/recurrenceEngine'
import { calcRemainingEnergy } from '@/services/energyService'
import type { DailyState, DailyReview, Task, TimeRecord } from '@/domain/models'

export function ReviewsPage() {
  const [selectedDate, setSelectedDate] = useState(today())
  const [state, setState] = useState<DailyState | null>(null)
  const [review, setReview] = useState<DailyReview | null>(null)
  const [dayTasks, setDayTasks] = useState<Task[]>([])
  const [timeRecords, setTimeRecords] = useState<TimeRecord[]>([])
  const [completions, setCompletions] = useState<number>(0)
  const [undoneTaskIds, setUndoneTaskIds] = useState<string[]>([])
  const [allCompletionsData, setAllCompletionsData] = useState<Array<{ taskId: string; completedDate: string; status: string; energyCostSnapshot: number }>>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  // 状态表单
  const [energyScore, setEnergyScore] = useState(5)
  const [moodScore, setMoodScore] = useState(5)
  const [stressScore, setStressScore] = useState(5)
  const [sleepHours, setSleepHours] = useState('')
  const [sleepQuality, setSleepQuality] = useState('')
  const [note, setNote] = useState('')

  // 复盘表单
  const [completed, setCompleted] = useState('')
  const [uncompleted, setUncompleted] = useState('')
  const [uncompletedReason, setUncompletedReason] = useState('')
  const [biggestGain, setBiggestGain] = useState('')
  const [mostDraining, setMostDraining] = useState('')
  const [tomorrowTop3, setTomorrowTop3] = useState('')
  const [knowledgeToSave, setKnowledgeToSave] = useState('')

  const stateRepo = new DexieDailyStateRepository()
  const reviewRepo = new DexieDailyReviewRepository()

  const loadDate = useCallback(async (date: string) => {
    setLoading(true)
    const taskRepo = new DexieTaskRepository()
    const timeRepo = new DexieTimeRecordRepository()
    const compRepo = new DexieCompletionRepository()

    const [s, r, allTasks, timeRecordsData, comps] = await Promise.all([
      stateRepo.getByDate(date),
      reviewRepo.getByDate(date),
      taskRepo.getAll(),
      timeRepo.getByDate(date),
      compRepo.getByDate(date),
    ])

    const dateTasks = allTasks.filter(t => !t.deletedAt && (t.plannedDate === date || t.dueDate === date))

    setState(s || null)
    setReview(r || null)
    setDayTasks(dateTasks)
    setTimeRecords(timeRecordsData)
    setCompletions(comps.length)
    setAllCompletionsData(comps)

    // 填充表单
    if (s) {
      setEnergyScore(s.energyScore)
      setMoodScore(s.moodScore)
      setStressScore(s.stressScore)
      setSleepHours(s.sleepHours?.toString() || '')
      setSleepQuality(s.sleepQuality?.toString() || '')
      setNote(s.note)
    } else {
      setEnergyScore(5); setMoodScore(5); setStressScore(5)
      setSleepHours(''); setSleepQuality(''); setNote('')
    }

    if (r) {
      setCompleted(r.completed)
      setUncompleted(r.uncompleted)
      setUncompletedReason(r.uncompletedReason)
      setBiggestGain(r.biggestGain)
      setMostDraining(r.mostDraining)
      setTomorrowTop3(r.tomorrowTop3)
      setKnowledgeToSave(r.knowledgeToSave)
      setUndoneTaskIds(r.uncompletedTaskIds || [])
    } else {
      // 自动带入当天任务
      const doneTasks = dateTasks.filter(t => t.status === 'done')
      const undoneTasks = dateTasks.filter(t => t.status !== 'done' && t.status !== 'cancelled')
      const totalMinutes = timeRecordsData.reduce((sum, r) => sum + r.durationMinutes, 0)

      setCompleted(
        doneTasks.length > 0
          ? doneTasks.map(t => `- ${t.title}`).join('\n')
          : (totalMinutes > 0 ? `记录 ${totalMinutes} 分钟工作时间` : '')
      )
      setUncompleted(
        undoneTasks.length > 0
          ? undoneTasks.map(t => `- ${t.title}`).join('\n')
          : ''
      )
      setUncompletedReason('')
      setBiggestGain('')
      setMostDraining('')
      setTomorrowTop3('')
      setKnowledgeToSave('')
    }

    setLoading(false)
  }, [])

  useEffect(() => { loadDate(selectedDate) }, [selectedDate, loadDate])

  // 快捷日期选择
  const dateOptions = () => {
    const options: { label: string; date: string }[] = []
    const d = new Date()
    options.push({ label: '今天', date: d.toISOString().split('T')[0] })
    d.setDate(d.getDate() - 1)
    options.push({ label: '昨天', date: d.toISOString().split('T')[0] })
    d.setDate(d.getDate() - 1)
    options.push({ label: '前天', date: d.toISOString().split('T')[0] })
    return options
  }

  const handleSaveState = async () => {
    const data: DailyState = {
      id: state?.id || generateId(),
      date: selectedDate,
      energyScore,
      moodScore,
      stressScore,
      sleepHours: sleepHours ? Number(sleepHours) : null,
      sleepQuality: sleepQuality ? Number(sleepQuality) : null,
      availableMinutes: null,
      note,
      createdAt: state?.createdAt || now(),
      updatedAt: now(),
    }
    await stateRepo.upsert(data)
    setState(data)
    showMessage('状态已保存')
  }

  const handleSaveReview = async () => {
    const data: DailyReview = {
      id: review?.id || generateId(),
      date: selectedDate,
      completed,
      uncompleted,
      uncompletedReason,
      biggestGain,
      mostDraining,
      tomorrowTop3,
      knowledgeToSave,
      isDraft: false,
      uncompletedTaskIds: undoneTaskIds,
      uncompletedTaskSnapshots: dayTasks
        .filter(t => undoneTaskIds.includes(t.id))
        .map(t => ({
          taskId: t.id, title: t.title, status: t.status,
          projectId: t.projectId, plannedDate: t.plannedDate,
          dueDate: t.dueDate, isHabit: t.isHabit,
        })),
      createdAt: review?.createdAt || now(),
      updatedAt: now(),
    }
    await reviewRepo.upsert(data)
    setReview(data)
    showMessage('复盘已保存')
  }

  const handleExportMarkdown = () => {
    const lines = [
      `# 每日复盘 - ${selectedDate}`,
      '',
      '## 状态',
      `- 精力：${energyScore}/10`,
      `- 情绪：${moodScore}/10`,
      `- 压力：${stressScore}/10`,
      sleepHours ? `- 睡眠：${sleepHours} 小时` : '',
      sleepQuality ? `- 睡眠质量：${sleepQuality}/10` : '',
      '',
      '## 任务完成情况',
      `共 ${dayTasks.length} 个任务，完成 ${completions} 个习惯`,
      ...dayTasks.map(t => `- [${t.status === 'done' ? 'x' : ' '}] ${t.title}`),
      '',
      '## 复盘内容',
      `### 今天完成了什么`,
      completed || '_无_',
      '',
      `### 哪些任务没有完成`,
      uncompleted || '_无_',
      '',
      `### 没完成的原因`,
      uncompletedReason || '_无_',
      '',
      `### 今天最大的收获`,
      biggestGain || '_无_',
      '',
      `### 最消耗精力的事情`,
      mostDraining || '_无_',
      '',
      `### 明天最重要的三件事`,
      tomorrowTop3 || '_无_',
      '',
      `### 值得沉淀的知识`,
      knowledgeToSave || '_无_',
    ].filter(l => l !== '').join('\n')

    const blob = new Blob([lines], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `daily-review-${selectedDate}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const showMessage = (msg: string) => {
    setMessage(msg)
    setTimeout(() => setMessage(''), 2000)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BookOpen size={24} className="text-blue-500" />
          <h1 className="text-xl font-bold text-slate-800">每日复盘</h1>
        </div>
        <div className="flex gap-2">
          {dateOptions().map(opt => (
            <button
              key={opt.date}
              onClick={() => setSelectedDate(opt.date)}
              className={cn(
                'btn-ghost text-xs py-1',
                selectedDate === opt.date && 'bg-blue-50 text-blue-700'
              )}
            >
              {opt.label}
            </button>
          ))}
          <input
            type="date"
            className="input w-36 text-sm"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
          />
        </div>
      </div>

      {message && (
        <div className="bg-green-50 text-green-700 px-4 py-2 rounded-lg text-sm">
          {message}
        </div>
      )}

      {/* 每日状态 */}
      <div className="card">
        <h2 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <Zap size={18} className="text-amber-500" />
          每日状态
        </h2>
        <div className="space-y-4">
          {/* 精力——改为只读摘要 */}
          <div className="bg-slate-50 rounded-lg p-3 mb-2">
            <p className="text-xs font-medium text-slate-600 mb-2">今日精力概览</p>
            <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
              <div>
                <p className="text-slate-400">已计划</p>
                <p className="font-bold text-slate-600">{
                  (() => {
                    const e = calcRemainingEnergy(dayTasks, allCompletionsData, selectedDate)
                    return e.planned
                  })()
                }</p>
              </div>
              <div>
                <p className="text-slate-400">已消耗</p>
                <p className="font-bold text-slate-600">{
                  (() => {
                    const e = calcRemainingEnergy(dayTasks, allCompletionsData, selectedDate)
                    return e.consumed
                  })()
                }</p>
              </div>
              <div>
                <p className="text-slate-400">剩余</p>
                <p className="font-bold text-slate-600">{
                  (() => {
                    const e = calcRemainingEnergy(dayTasks, allCompletionsData, selectedDate)
                    return e.remaining
                  })()
                }</p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">情绪 (1-10)</label>
              <input type="number" className="input" value={moodScore} onChange={e => setMoodScore(Number(e.target.value))} min={1} max={10} />
            </div>
            <div>
              <label className="label">压力 (1-10)</label>
              <input type="number" className="input" value={stressScore} onChange={e => setStressScore(Number(e.target.value))} min={1} max={10} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">睡眠时长（小时）</label>
              <input type="number" className="input" value={sleepHours} onChange={e => setSleepHours(e.target.value)} placeholder="可选" min="0" max="24" />
            </div>
            <div>
              <label className="label">睡眠质量 (1-10)</label>
              <input type="number" className="input" value={sleepQuality} onChange={e => setSleepQuality(e.target.value)} placeholder="可选" min="1" max="10" />
            </div>
          </div>
          <div>
            <label className="label">备注</label>
            <textarea className="input" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="今天的状态备注..." />
          </div>
          <button onClick={handleSaveState} className="btn-primary flex items-center gap-1.5 text-sm">
            <Save size={14} /> 保存状态
          </button>
        </div>
      </div>

      {/* 每日复盘 */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-slate-800 flex items-center gap-2">
            <Calendar size={18} className="text-blue-500" />
            每日复盘
          </h2>
          <button onClick={handleExportMarkdown} className="btn-ghost text-xs flex items-center gap-1">
            <Download size={12} /> 导出 Markdown
          </button>
        </div>

        <div className="space-y-4">
          <ReviewField
            label="今天完成了什么？"
            value={completed}
            onChange={setCompleted}
            placeholder="列出今天完成的任务..."
          />
          <div>
            <label className="label">哪些任务没有完成？</label>
            <UndoneTasksSelector
              tasks={dayTasks}
              date={selectedDate}
              completions={allCompletionsData}
              selectedIds={undoneTaskIds}
              onChange={setUndoneTaskIds}
            />
          </div>
          <ReviewField
            label="没完成的主要原因是什么？"
            value={uncompletedReason}
            onChange={setUncompletedReason}
            placeholder="分析原因..."
          />
          <ReviewField
            label="今天最大的收获是什么？"
            value={biggestGain}
            onChange={setBiggestGain}
            placeholder="记录今天的收获..."
          />
          <ReviewField
            label="今天最消耗精力的事情是什么？"
            value={mostDraining}
            onChange={setMostDraining}
            placeholder="记录消耗精力的事情..."
          />
          <ReviewField
            label="明天最重要的三件事"
            value={tomorrowTop3}
            onChange={setTomorrowTop3}
            placeholder="1.&#10;2.&#10;3."
            minHeight={140}
          />
          <ReviewField
            label="哪些内容值得沉淀为知识？"
            value={knowledgeToSave}
            onChange={setKnowledgeToSave}
            placeholder="值得记录的知识点..."
          />
          <button onClick={handleSaveReview} className="btn-primary flex items-center gap-1.5 text-sm">
            <Save size={14} /> 保存复盘
          </button>
        </div>
      </div>

      {/* 当日任务摘要 */}
      {dayTasks.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">当日任务 ({dayTasks.length})</h3>
          <div className="space-y-1">
            {dayTasks.map(task => (
              <div key={task.id} className="text-xs p-1.5 flex items-center gap-2">
                <div className={cn(
                  'w-3 h-3 rounded-full flex-shrink-0',
                  task.status === 'done' ? 'bg-green-500' :
                  task.status === 'doing' ? 'bg-blue-500' : 'bg-slate-300'
                )} />
                <span className={cn(task.status === 'done' && 'line-through text-slate-400')}>
                  {task.title}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 当日时间记录 */}
      {timeRecords.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
            <Clock size={14} className="text-blue-500" />
            时间记录 ({timeRecords.length})
            <span className="text-xs font-normal text-slate-500 ml-auto">
              合计 {timeRecords.reduce((s, r) => s + r.durationMinutes, 0)} 分钟
            </span>
          </h3>
          <div className="space-y-1">
            {timeRecords.map(r => (
              <div key={r.id} className="text-xs p-1.5 flex items-center justify-between">
                <span className="text-slate-600">{r.durationMinutes} 分钟</span>
                <span className="badge badge-p3 text-[10px]">{r.source}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ScoreSlider({
  label, value, onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-slate-500">{label}</span>
        <span className="text-sm font-bold text-slate-700">{value}</span>
      </div>
      <input
        type="range"
        min={1}
        max={10}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-blue-500"
      />
    </div>
  )
}

function ReviewField({
  label, value, onChange, placeholder, minHeight = 120,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  minHeight?: number
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <AutoGrowTextarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        minHeight={minHeight}
        maxHeight={300}
      />
    </div>
  )
}
