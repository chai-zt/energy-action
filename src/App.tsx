import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import { AppLayout } from './app/AppLayout'
import { DashboardPage } from './modules/dashboard/DashboardPage'
import { GoalsPage } from './modules/goals/GoalsPage'
import { GoalDetailPage } from './modules/goals/GoalDetailPage'
import { TasksPage } from './modules/tasks/TasksPage'
import { CalendarPage } from './modules/calendar/CalendarPage'
import { TimerPage } from './modules/timer/TimerPage'
import { ReviewsPage } from './modules/reviews/ReviewsPage'
import { SettingsPage } from './modules/settings/SettingsPage'

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Navigate to="/today" replace />} />
        <Route path="/today" element={<DashboardPage />} />
        <Route path="/goals" element={<GoalsPage />} />
        <Route path="/goals/:goalId" element={<GoalDetailPage />} />
        <Route path="/projects" element={<Navigate to="/tasks" replace />} />
        <Route path="/projects/:projectId" element={<LegacyProjectRedirect />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/timer" element={<TimerPage />} />
        <Route path="/reviews" element={<ReviewsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}

function LegacyProjectRedirect() {
  const { projectId } = useParams<{ projectId: string }>()
  return <Navigate to={`/tasks?group=${encodeURIComponent(projectId || '')}`} replace />
}
