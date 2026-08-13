// ============================================================
// AutoGrowTextarea — 输入框自动增长
// ============================================================

import { useRef, useEffect, forwardRef, useImperativeHandle, useCallback, type Ref, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export interface AutoGrowTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows'> {
  minHeight?: number
  maxHeight?: number
  defaultExpanded?: boolean
}

export const AutoGrowTextarea = forwardRef<HTMLTextAreaElement, AutoGrowTextareaProps>(
  ({ minHeight = 120, maxHeight = 300, value, className, onInput, onChange, ...rest }, ref) => {
    const innerRef = useRef<HTMLTextAreaElement>(null)

    useImperativeHandle(ref, () => innerRef.current as HTMLTextAreaElement)

    useEffect(() => {
      const el = innerRef.current
      if (!el) return

      // 重置高度以正确计算 scrollHeight
      el.style.height = `${minHeight}px`
      const scrollHeight = el.scrollHeight
      const nextHeight = Math.min(maxHeight, Math.max(minHeight, scrollHeight))
      el.style.height = `${nextHeight}px`
    }, [value, minHeight, maxHeight])

    return (
      <textarea
        ref={innerRef}
        value={value}
        onInput={onInput}
        onChange={onChange}
        rows={4}
        style={{ minHeight: `${minHeight}px`, maxHeight: `${maxHeight}px` }}
        className={cn('input resize-none overflow-y-auto', className)}
        {...rest}
      />
    )
  }
)

AutoGrowTextarea.displayName = 'AutoGrowTextarea'
