import type { Project, UUID } from '@/domain/models'
import type { ProjectRepository } from '@/repositories/interfaces'
import { createProject, getAllProjects, getProjectById, softDeleteProject, updateProject } from '@/services/apiClient'
import { db } from './db'

let legacyMigration: Promise<void> | null = null

async function migrateLegacyProjects(): Promise<void> {
  const remoteIds = new Set((await getAllProjects()).map(project => project.id))
  const legacyProjects = (await db.projects.toArray()).filter(project => !project.deletedAt)
  for (const project of legacyProjects) {
    if (!remoteIds.has(project.id)) await createProject(project)
  }
}

function ensureLegacyProjectsMigrated(): Promise<void> {
  legacyMigration ??= migrateLegacyProjects().catch(error => {
    legacyMigration = null
    throw error
  })
  return legacyMigration
}

export class ApiProjectRepository implements ProjectRepository {
  private async getProjects(): Promise<Project[]> {
    await ensureLegacyProjectsMigrated()
    return getAllProjects()
  }

  async getAll(): Promise<Project[]> { return this.getProjects() }

  async getById(id: UUID): Promise<Project | undefined> {
    await ensureLegacyProjectsMigrated()
    try { return await getProjectById(id) } catch { return undefined }
  }

  async getByGoalId(goalId: UUID): Promise<Project[]> {
    return (await this.getProjects()).filter(project => project.goalId === goalId)
  }

  async create(project: Project): Promise<UUID> {
    await ensureLegacyProjectsMigrated()
    return (await createProject(project)).id
  }

  async update(id: UUID, data: Partial<Project>): Promise<void> {
    await ensureLegacyProjectsMigrated()
    await updateProject(id, data)
  }

  async softDelete(id: UUID): Promise<void> {
    await ensureLegacyProjectsMigrated()
    await softDeleteProject(id)
  }
}
