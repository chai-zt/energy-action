// ============================================================
// UX-1 测试 — 首次访问使用指南 + 持久化 + Header 调整
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// mock AI 相关组件，聚焦 onboarding 行为（避免 fetch / 副作用）
vi.mock('@/components/AIAssistantFab', () => ({ AIAssistantFab: () => null }))
vi.mock('@/components/AiStatusEntry', () => ({ AiStatusEntry: () => null }))

import { AppLayout } from '@/app/AppLayout'
import { ONBOARDING_COMPLETED_KEY, isOnboardingCompleted, markOnboardingCompleted } from '@/services/onboarding'
import { getCurrentEnergy } from '@/services/currentEnergy'

const STORAGE_KEY = ONBOARDING_COMPLETED_KEY

function renderApp() {
  return render(
    <MemoryRouter>
      <AppLayout />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('onboarding service', () => {
  it('默认未完成（无 localStorage 记录）', () => {
    expect(isOnboardingCompleted()).toBe(false)
  })

  it('markOnboardingCompleted 写入 true', () => {
    markOnboardingCompleted()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true')
    expect(isOnboardingCompleted()).toBe(true)
  })
})

describe('UX-1 首次访问 + 使用指南', () => {
  it('A. 无 onboarding 记录 → 首次启动自动打开弹窗', () => {
    renderApp()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('欢迎使用 Energy Action')).toBeInTheDocument()
  })

  it('B. 点击「开始使用」→ 关闭并写入 localStorage=true', () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: '开始使用' }))
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('B2. 点击 X → 关闭并写入 localStorage=true', () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('C. 已记录完成 → 重新初始化 App 不再自动打开', () => {
    localStorage.setItem(STORAGE_KEY, 'true')
    renderApp()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('D. 点击 Header「使用指南」→ 可再次打开', () => {
    localStorage.setItem(STORAGE_KEY, 'true')
    renderApp()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '使用指南' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('E. 手动打开/关闭不改变其他业务状态（currentEnergy 不受影响）', () => {
    localStorage.setItem(STORAGE_KEY, 'true')
    renderApp()
    const before = getCurrentEnergy()
    fireEvent.click(screen.getByRole('button', { name: '使用指南' }))
    fireEvent.click(screen.getByRole('button', { name: '开始使用' }))
    expect(getCurrentEnergy()).toBe(before)
  })

  it('F. Header 不再有 CurrentEnergySelector，但 currentEnergy 业务代码仍存在', () => {
    renderApp()
    expect(screen.queryByText('低精力')).not.toBeInTheDocument()
    expect(screen.queryByText('中精力')).not.toBeInTheDocument()
    expect(screen.queryByText('高精力')).not.toBeInTheDocument()
    expect(['low', 'medium', 'high']).toContain(getCurrentEnergy())
  })
})
