import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, FolderKanban, ChevronRight, Edit2, Trash2 } from 'lucide-react'
import { DexieProjectRepository, DexieTaskRepository } from '@/storage/repositories'
import { cn, generateId, now, formatDate } from '@/lib/utils'
import type { Project } from '@/domain/models'

const statusLabel: Record<string, string> = {
  backlog: '待规划', planned: '已规划', active: '进行中',
  blocked: '已阻塞', completed: '已完成', archived: '已归档'
}

export function ProjectsPage() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  const projectRepo = new DexieProjectRepository()
  const taskRepo = new DexieTaskRepository()

  const load = useCallback(async () => {
    const data = await projectRepo.getAll()
    setProjects(data)
    // 统计每个项目的任务数
    const allTasks = await taskRepo.getAll()
    const counts: Record<string, number> = {}
    data.forEach(p => {
      counts[p.id] = allTasks.filter(t => t.projectId === p.id && !t.deletedAt).length
    })
    setTasks(counts)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleDelete = async (id: string) => {
    if (!confirm('确定归档此项目？')) return
    await projectRepo.softDelete(id)
    load()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FolderKanban size={24} className="text-blue-500" />
          <h1 className="text-xl font-bold text-slate-800">项目管理</h1>
          <span className="badge badge-p2">{projects.length} 个项目</span>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-1.5">
          <Plus size={16} /> 新建项目
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="card text-center py-12">
          <FolderKanban size={48} className="mx-auto text-slate-300 mb-4" />
          <h2 className="text-lg font-semibold text-slate-700 mb-2">还没有项目</h2>
          <p className="text-sm text-slate-500 mb-4">创建项目来组织你的任务</p>
          <button onClick={() => setShowCreate(true)} className="btn-primary">创建项目</button>
        </div>
      ) : (
        <div className="grid gap-3">
          {projects.map(p => (
            <div
              key={p.id}
              className="card flex items-center gap-4 cursor-pointer hover:border-blue-200 transition-colors"
              onClick={() => navigate(`/projects/${p.id}`)}
            >
              <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: p.color + '20' }}>
                <FolderKanban size={18} style={{ color: p.color }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-800 truncate">{p.name}</span>
                  <span className={cn(
                    'badge text-[10px]',
                    p.status === 'active' ? 'badge-success' :
                    p.status === 'blocked' ? 'badge-warning' : 'badge-p3'
                  )}>{statusLabel[p.status]}</span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                  <span>{tasks[p.id] || 0} 个任务</span>
                  {p.dueDate && <span>截止 {formatDate(p.dueDate)}</span>}
                </div>
                {p.progress > 0 && (
                  <div className="mt-1.5 w-full bg-slate-100 rounded-full h-1.5">
                    <div
                      className="h-1.5 rounded-full transition-all"
                      style={{ width: `${p.progress}%`, backgroundColor: p.color }}
                    />
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => handleDelete(p.id)}
                  className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-red-500"
                >
                  <Trash2 size={14} />
                </button>
                <ChevronRight size={16} className="text-slate-300" />
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load() }}
        />
      )}
    </div>
  )
}

function CreateProjectModal({
  onClose, onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#3b82f6')
  const nowStr = now()

  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4']

  const handleSubmit = async () => {
    if (!name.trim()) return
    const repo = new DexieProjectRepository()
    const project: Project = {
      id: generateId(),
      name: name.trim(),
      description,
      goalId: null,
      keyResultId: null,
      status: 'active',
      priority: 0,
      startDate: null,
      dueDate: null,
      progress: 0,
      progressMode: 'task',
      color,
      icon: 'folder',
      completedAt: null,
      createdAt: nowStr,
      updatedAt: nowStr,
      deletedAt: null,
    }
    await repo.create(project)
    onCreated()
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-6 max-w-sm w-full shadow-xl">
        <h2 className="font-semibold text-lg text-slate-800 mb-4">新建项目</h2>
        <div className="space-y-3">
          <div>
            <label className="label">项目名称</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="项目名称" autoFocus />
          </div>
          <div>
            <label className="label">说明</label>
            <textarea className="input" rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="可选" />
          </div>
          <div>
            <label className="label">颜色</label>
            <div className="flex gap-2">
              {colors.map(c => (
                <button
                  key={c}
                  className={cn('w-7 h-7 rounded-full border-2 transition-all', c === color ? 'border-slate-800 scale-110' : 'border-transparent')}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-3 justify-end mt-4">
          <button onClick={onClose} className="btn-secondary">取消</button>
          <button onClick={handleSubmit} className="btn-primary" disabled={!name.trim()}>创建</button>
        </div>
      </div>
    </div>
  )
}
