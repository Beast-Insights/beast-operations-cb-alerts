// Tremor Badge [v1.0.0]

import React from "react"
import { tv, type VariantProps } from "tailwind-variants"

import { cx } from "@/lib/cx"

const badgeVariants = tv({
  base: cx(
    "inline-flex items-center gap-x-1 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset",
  ),
  variants: {
    variant: {
      default: [
        "bg-blue-50 text-blue-900 ring-blue-500/30",
        "dark:bg-blue-400/10 dark:text-blue-400 dark:ring-blue-400/30",
      ],
      neutral: [
        "bg-gray-50 text-gray-900 ring-gray-500/30",
        "dark:bg-gray-400/10 dark:text-gray-400 dark:ring-gray-400/20",
      ],
      success: [
        "bg-emerald-50 text-emerald-900 ring-emerald-600/30",
        "dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-emerald-400/20",
      ],
      error: [
        "bg-red-50 text-red-900 ring-red-600/20",
        "dark:bg-red-400/10 dark:text-red-400 dark:ring-red-400/20",
      ],
      warning: [
        "bg-yellow-50 text-yellow-900 ring-yellow-600/30",
        "dark:bg-yellow-400/10 dark:text-yellow-500 dark:ring-yellow-400/20",
      ],
    },
  },
  defaultVariants: {
    variant: "default",
  },
})

// Color mapping for colorful pill badges
const colorClasses: Record<string, string> = {
  // Core colors
  blue: "bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-400/10 dark:text-blue-400 dark:ring-blue-400/20",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-emerald-400/20",
  green: "bg-green-50 text-green-700 ring-green-600/20 dark:bg-green-400/10 dark:text-green-400 dark:ring-green-400/20",
  red: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-400/10 dark:text-red-400 dark:ring-red-400/20",
  amber: "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-400/10 dark:text-amber-400 dark:ring-amber-400/20",
  yellow: "bg-yellow-50 text-yellow-700 ring-yellow-600/20 dark:bg-yellow-400/10 dark:text-yellow-500 dark:ring-yellow-400/20",
  gray: "bg-gray-50 text-gray-600 ring-gray-500/20 dark:bg-gray-400/10 dark:text-gray-400 dark:ring-gray-400/20",
  // Extended colors for variety
  purple: "bg-purple-50 text-purple-700 ring-purple-600/20 dark:bg-purple-400/10 dark:text-purple-400 dark:ring-purple-400/20",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-400/10 dark:text-violet-400 dark:ring-violet-400/20",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-600/20 dark:bg-indigo-400/10 dark:text-indigo-400 dark:ring-indigo-400/20",
  cyan: "bg-cyan-50 text-cyan-700 ring-cyan-600/20 dark:bg-cyan-400/10 dark:text-cyan-400 dark:ring-cyan-400/20",
  sky: "bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-400/10 dark:text-sky-400 dark:ring-sky-400/20",
  teal: "bg-teal-50 text-teal-700 ring-teal-600/20 dark:bg-teal-400/10 dark:text-teal-400 dark:ring-teal-400/20",
  orange: "bg-orange-50 text-orange-700 ring-orange-600/20 dark:bg-orange-400/10 dark:text-orange-400 dark:ring-orange-400/20",
  rose: "bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-400/10 dark:text-rose-400 dark:ring-rose-400/20",
  pink: "bg-pink-50 text-pink-700 ring-pink-600/20 dark:bg-pink-400/10 dark:text-pink-400 dark:ring-pink-400/20",
  lime: "bg-lime-50 text-lime-700 ring-lime-600/20 dark:bg-lime-400/10 dark:text-lime-400 dark:ring-lime-400/20",
}

type BadgeColor = keyof typeof colorClasses

interface BadgeProps
  extends React.ComponentPropsWithoutRef<"span">,
  VariantProps<typeof badgeVariants> {
  color?: BadgeColor
}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, color, ...props }: BadgeProps, forwardedRef) => {
    // If color is provided, use color classes; otherwise use variant
    const colorClass = color ? colorClasses[color] : undefined

    return (
      <span
        ref={forwardedRef}
        className={cx(
          "inline-flex items-center gap-x-1 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset",
          colorClass || badgeVariants({ variant }),
          className
        )}
        tremor-id="tremor-raw"
        {...props}
      />
    )
  },
)

Badge.displayName = "Badge"

export { Badge, badgeVariants, type BadgeProps, type BadgeColor }
