import * as React from 'react'
import { cn } from '@/lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-10 w-full rounded-[14px] border border-white/10 bg-white/[0.06] px-3.5 py-2 text-sm text-foreground shadow-inner outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-[#0A84FF]/70 focus:ring-2 focus:ring-[#0A84FF]/30 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        ref={ref}
        {...props}
      />
    )
  },
)
Input.displayName = 'Input'

export { Input }
