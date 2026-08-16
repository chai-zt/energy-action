import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Target, CheckSquare,
  Calendar, BookOpen, Settings, Menu, X, Timer, CircleHelp,
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { AIAssistantFab } from '@/components/AIAssistantFab'
import { AiStatusEntry } from '@/components/AiStatusEntry'
import { UsageGuideDialog } from '@/components/UsageGuideDialog'
import { isOnboardingCompleted, markOnboardingCompleted } from '@/services/onboarding'

const desktopNav = [
  { path: '/today', label: '首页', icon: LayoutDashboard },
  { path: '/goals', label: '目标', icon: Target },
  { path: '/tasks', label: '任务', icon: CheckSquare },
  { path: '/calendar', label: '日历', icon: Calendar },
  { path: '/timer', label: '番茄钟', icon: Timer },
  { path: '/reviews', label: '复盘', icon: BookOpen },
  { path: '/settings', label: '设置', icon: Settings },
]

const mobileNav = [
  { path: '/today', label: '首页', icon: LayoutDashboard },
  { path: '/tasks', label: '任务', icon: CheckSquare },
  { path: '/calendar', label: '日历', icon: Calendar },
  { path: '/timer', label: '番茄钟', icon: Timer },
  { path: '/settings', label: '设置', icon: Settings },
]

export function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  // 首次访问自动弹窗（App 全局初始化时判断一次；关闭后写 onboarding 完成态，不再自动弹出）
  const [guideOpen, setGuideOpen] = useState<boolean>(() => !isOnboardingCompleted())

  const openGuide = () => setGuideOpen(true)
  const closeGuide = () => {
    markOnboardingCompleted()
    setGuideOpen(false)
  }

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Desktop Sidebar */}
      {!isMobile && (
        <aside className="fixed left-0 top-0 bottom-0 w-56 bg-white border-r border-slate-200 flex flex-col z-30">
          <div className="h-14 flex items-center px-4 border-b border-slate-100">
            <span className="font-bold text-lg text-slate-800">Energy Action</span>
          </div>
          <nav className="flex-1 py-2 px-2">
            {desktopNav.map(item => {
              const active = location.pathname === item.path
              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors mb-0.5',
                    active
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-slate-600 hover:bg-slate-100'
                  )}
                >
                  <item.icon size={18} />
                  {item.label}
                </button>
              )
            })}
          </nav>
        </aside>
      )}

      {/* Main Content */}
      <main className={cn(
        isMobile ? 'pb-16' : 'ml-56',
        'min-h-screen'
      )}>
        {/* Mobile Header */}
        {isMobile && (
          <header className="sticky top-0 z-20 bg-white border-b border-slate-200 h-14 flex items-center justify-between px-4">
            <span className="font-bold text-lg text-slate-800">Energy Action</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openGuide}
                className="p-2 rounded-lg hover:bg-slate-100 touch-target"
                aria-label="使用指南"
              >
                <CircleHelp size={20} className="text-slate-500" />
              </button>
              <AiStatusEntry />
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="p-2 rounded-lg hover:bg-slate-100 touch-target"
              >
                {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
            </div>
          </header>
        )}

        {/* Mobile Menu Drawer */}
        {isMobile && mobileMenuOpen && (
          <>
            <div
              className="fixed inset-0 bg-black/30 z-30"
              onClick={() => setMobileMenuOpen(false)}
            />
            <div className="fixed right-0 top-14 bottom-0 w-56 bg-white border-l border-slate-200 z-40 p-2">
              {desktopNav.map(item => {
                const active = location.pathname === item.path
                return (
                  <button
                    key={item.path}
                    onClick={() => { navigate(item.path); setMobileMenuOpen(false) }}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors mb-0.5',
                      active
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-slate-600 hover:bg-slate-100'
                    )}
                  >
                    <item.icon size={18} />
                    {item.label}
                  </button>
                )
              })}
            </div>
          </>
        )}

        {/* Page Content */}
        <div className="p-4 md:p-6">
          <Outlet />
        </div>
      </main>

      {/* Mobile Bottom Nav */}
      {isMobile && (
        <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex items-center justify-around z-20 mobile-safe-bottom">
          {mobileNav.map(item => {
            const active = location.pathname === item.path
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={cn(
                  'flex flex-col items-center justify-center py-1.5 px-2 min-w-[64px] touch-target',
                  active ? 'text-blue-600' : 'text-slate-400'
                )}
              >
                <item.icon size={20} />
                <span className="text-[10px] mt-0.5">{item.label}</span>
              </button>
            )
          })}
        </nav>
      )}

      {/* 全局入口：使用指南 + AI 配置（桌面右上角） */}
      {!isMobile && (
        <div className="fixed top-3 right-4 z-40 flex items-center gap-2">
          <button
            type="button"
            onClick={openGuide}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-slate-200 bg-white text-xs font-medium text-slate-600 hover:opacity-75 transition-opacity"
            title="使用指南"
          >
            <CircleHelp size={12} />
            使用指南
          </button>
          <AiStatusEntry />
        </div>
      )}

      {/* 全局 AI 助手浮动入口 */}
      <AIAssistantFab />

      {/* 首次访问 / 手动「使用指南」共用的唯一弹窗 */}
      <UsageGuideDialog open={guideOpen} onClose={closeGuide} />
    </div>
  )
}
