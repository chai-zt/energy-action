import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, FolderKanban, Plus, MoreHorizontal, Trash2 } from 'lucide-react'
import {
  DndContext, closestCorners, PointerSensor, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import {
  DexieProjectRepository, DexieTaskRepository,
  DexieGoalRepository,
} from '@/storage/repositories'
import { cn, generateId, now } from '@/lib/utils'
import type { Project, Task, ProjectColumn } from '@/domain/models'

// 扩展的 ProjectColumn Repository（如果不存在）
const columnRepo = {
  async getByProjectId(projectId: string): Promise<ProjectColumn[]> {
    const { db } = await import('@/storage/db')
    return db.projectColumns.where('projectId').equals(projectId).toArray()
  },
  async create(col: ProjectColumn): Promise<void> {
    const { db } = await import('@/storage/db')
    await db.projectColumns.add(col)
  }
}

const statusLabel: Record<string, string> = {
  backlog: '待规划', planned: '已规划', active: '进行中',
  blocked: '已阻塞', completed: '已完成', archived: '已归档'
}

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [columns, setColumns] = useState<ProjectColumn[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddTask, setShowAddTask] = useState<string | null>(null) // columnId
  const [newTaskTitle, setNewTaskTitle] = useState('')

  const projectRepo = new DexieProjectRepository()
  const taskRepo = new DexieTaskRepository()

  const loadData = useCallback(async () => {
    if (!projectId) return
    const p = await projectRepo.getById(projectId)
    if (!p) { navigate('/projects'); return }
    setProject(p)
    const cols = await columnRepo.getByProjectId(projectId)
    if (cols.length === 0) {
      // 自动创建默认列
      const defaultCols: ProjectColumn[] = [
        { id: generateId(), projectId, name: 'Todo', order: 0, color: '#94a3b8', createdAt: now(), updatedAt: now() },
        { id: generateId(), projectId, name: 'Doing', order: 1, color: '#3b82f6', createdAt: now(), updatedAt: now() },
        { id: generateId(), projectId, name: 'Done', order: 2, color: '#22c55e', createdAt: now(), updatedAt: now() },
      ]
      await Promise.all(defaultCols.map(c => columnRepo.create(c)))
      setColumns(defaultCols)
    } else {
      setColumns(cols.sort((a, b) => a.order - b.order))
    }
    const allTasks = await taskRepo.getByProjectId(projectId)
    setTasks(allTasks.filter(t => !t.deletedAt))
    setLoading(false)
  }, [projectId])

  useEffect(() => { loadData() }, [loadData])

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return
    const taskId = active.id as string
    const targetColId = over.id as string

    const task = tasks.find(t => t.id === taskId)
    if (!task) return

    const newStatus = targetColId.includes('todo') ? 'todo' :
                      targetColId.includes('doing') ? 'doing' :
                      targetColId.includes('done') ? 'done' : task.status

    await taskRepo.update(taskId, {
      columnId: targetColId,
      status: newStatus,
      completedAt: newStatus === 'done' ? now() : task.completedAt,
    })
    loadData()
  }

  const handleAddTask = async (columnId: string) => {
    if (!newTaskTitle.trim() || !projectId) return
    const col = columns.find(c => c.id === columnId)
    const taskStatus: Task['status'] = col?.name === 'Todo' ? 'todo' :
                                        col?.name === 'Doing' ? 'doing' :
                                        col?.name === 'Done' ? 'done' : 'todo'
    const task: Task = {
      id: generateId(),
      title: newTaskTitle.trim(),
      description: '',
      projectId,
      goalId: project?.goalId || null,
      keyResultId: project?.keyResultId || null,
      columnId: columnId,
      status: taskStatus,
      userPriority: null,
      aiPriorityScore: 0,
      aiPriorityLevel: null,
      aiPriorityReason: '',
      dueDate: null,
      plannedDate: null,
      estimatedMinutes: 0,
      actualMinutes: 0,
      cognitiveLoad: 'medium',
      energyDemand: 3,
      recurrenceRule: null,
      isHabit: false,
      completedAt: taskStatus === 'done' ? now() : null,
      parentTaskId: null,
      order: 0,
      createdAt: now(),
      updatedAt: now(),
      deletedAt: null,
    }
    await taskRepo.create(task)
    setNewTaskTitle('')
    setShowAddTask(null)
    loadData()
  }

  const handleDeleteTask = async (taskId: string) => {
    await taskRepo.softDelete(taskId)
    loadData()
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    )
  }

  if (!project) return null

  return (
    <div className="max-w-full mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/projects')} className="btn-ghost flex items-center gap-1.5">
          <ArrowLeft size={16} />
        </button>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: project.color + '20' }}>
          <FolderKanban size={16} style={{ color: project.color }} />
        </div>
        <div>
          <h1 className="text-lg font-bold text-slate-800">{project.name}</h1>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className={cn(
              'badge text-[10px]',
              project.status === 'active' ? 'badge-success' : 'badge-p3'
            )}>{statusLabel[project.status]}</span>
            <span>{tasks.length} 个任务</span>
          </div>
        </div>
      </div>

      {/* Kanban Board */}
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4" style={{ minHeight: '60vh' }}>
          {columns.map(col => {
            const colTasks = tasks.filter(t => t.columnId === col.id).sort((a, b) => a.order - b.order)
            return (
              <KanbanColumn
                key={col.id}
                column={col}
                tasks={colTasks}
                isAdding={showAddTask === col.id}
                newTitle={newTaskTitle}
                onNewTitleChange={setNewTaskTitle}
                onAddTask={() => handleAddTask(col.id)}
                onShowAdd={() => setShowAddTask(showAddTask === col.id ? null : col.id)}
                onDeleteTask={handleDeleteTask}
              />
            )
          })}
        </div>
      </DndContext>
    </div>
  )
}

function KanbanColumn({
  column, tasks, isAdding, newTitle,
  onNewTitleChange, onAddTask, onShowAdd, onDeleteTask,
}: {
  column: ProjectColumn
  tasks: Task[]
  isAdding: boolean
  newTitle: string
  onNewTitleChange: (v: string) => void
  onAddTask: () => void
  onShowAdd: () => void
  onDeleteTask: (id: string) => void
}) {
  const { setNodeRef } = useDroppable({ id: column.id })

  return (
    <div ref={setNodeRef} className="flex-shrink-0 w-72 flex flex-col">
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: column.color }} />
          <span className="text-sm font-semibold text-slate-700">{column.name}</span>
          <span className="badge badge-p3 text-[10px]">{tasks.length}</span>
        </div>
        <button onClick={onShowAdd} className="p-1 rounded hover:bg-slate-100 text-slate-400">
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 space-y-2 min-h-[100px]">
        {tasks.map(task => (
          <KanbanCard key={task.id} task={task} onDelete={() => onDeleteTask(task.id)} />
        ))}
        {isAdding && (
          <div className="card border-blue-200 p-2">
            <input
              className="input text-sm"
              value={newTitle}
              onChange={e => onNewTitleChange(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && onAddTask()}
              placeholder="输入任务标题..."
              autoFocus
            />
            <div className="flex gap-2 mt-2">
              <button onClick={onAddTask} className="btn-primary text-xs py-1 px-3">添加</button>
              <button onClick={onShowAdd} className="btn-ghost text-xs py-1 px-3">取消</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function KanbanCard({ task, onDelete }: { task: Task; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id })

  const style = transform ? {
    transform: `translate(${transform.x}px, ${transform.y}px)`,
  } : undefined

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        'card cursor-grab active:cursor-grabbing transition-shadow',
        isDragging && 'shadow-lg opacity-80'
      )}
      style={style}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-slate-700 flex-1">{task.title}</p>
        <button onClick={(e) => { e.stopPropagation(); onDelete() }} className="p-1 text-slate-300 hover:text-red-500 flex-shrink-0">
          <Trash2 size={12} />
        </button>
      </div>
      {task.dueDate && (
        <p className="text-xs text-slate-400 mt-1">截止: {task.dueDate}</p>
      )}
      {task.estimatedMinutes > 0 && (
        <p className="text-xs text-slate-400 mt-0.5">预计: {task.estimatedMinutes} 分钟</p>
      )}
    </div>
  )
}

// We need to have this repo accessible
const DexieProjectColumnRepository = {
  async getByProjectId(projectId: string): Promise<ProjectColumn[]> {
    const { db } = await import('@/storage/db')
    return db.projectColumns.where('projectId').equals(projectId).toArray()
  },
  async create(col: ProjectColumn): Promise<void> {
    const { db } = await import('@/storage/db')
    await db.projectColumns.add(col)
  },
}
