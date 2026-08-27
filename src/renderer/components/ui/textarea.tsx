import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Textarea styled for the signature glass style design (v0.9.0): glass panel, 14px
 * radius, focus ring in iOS blue.
 */
const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={cn(
          'flex min-h-[60px] w-full rounded-[14px] border border-white/10 bg-white/[0.06] px-3.5 py-2.5 text-sm text-foreground shadow-inner outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-[#0A84FF]/70 focus:ring-2 focus:ring-[#0A84FF]/30 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    )
  },
)
Textarea.displayName = 'Textarea'

export { Textarea }
