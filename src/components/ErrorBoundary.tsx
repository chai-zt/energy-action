import { Component, type ReactNode, type ErrorInfo } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-50 flex items-center justify-center">
              <AlertTriangle size={32} className="text-red-500" />
            </div>
            <h1 className="text-xl font-bold text-slate-800 mb-2">页面出错了</h1>
            <p className="text-sm text-slate-600 mb-6">
              应用遇到了一个意外错误。请尝试刷新页面。
            </p>
            {this.state.error && (
              <div className="bg-slate-50 rounded-lg p-3 mb-6 text-left">
                <p className="text-xs text-red-600 font-mono break-all">
                  {this.state.error.message}
                </p>
              </div>
            )}
            <div className="flex gap-3 justify-center">
              <button onClick={this.handleReset} className="btn-primary flex items-center gap-2">
                <RotateCcw size={16} />
                刷新页面
              </button>
              <button
                onClick={() => {
                  localStorage.clear()
                  window.location.reload()
                }}
                className="btn-secondary"
              >
                清除数据并刷新
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
