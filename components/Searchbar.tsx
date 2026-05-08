// Tremor Raw Searchbar [v1.0.0]

import { RiSearchLine } from "@remixicon/react"
import * as React from "react"

import { cx, focusInput } from "@/lib/utils"

interface SearchbarProps extends React.InputHTMLAttributes<HTMLInputElement> {
  inputClassName?: string
}

const Searchbar = React.forwardRef<HTMLInputElement, SearchbarProps>(
  (
    {
      className,
      inputClassName,
      type = "search",
      ...props
    },
    forwardedRef,
  ) => {
    return (
      <div className={cx("relative w-full", className)}>
        <input
          ref={forwardedRef}
          type={type}
          className={cx(
            // base
            "relative block w-full appearance-none rounded-md border px-2.5 py-1.5 pl-8 outline-none transition sm:text-sm",
            // border color
            "border-transparent dark:border-gray-800",
            // text color
            "text-gray-900 dark:text-gray-50",
            // placeholder color
            "placeholder-gray-400 dark:placeholder-gray-500",
            // background color
            "bg-gray-100 dark:bg-gray-950",
            // disabled
            "disabled:border-gray-300 disabled:bg-gray-100 disabled:text-gray-400",
            "disabled:dark:border-gray-700 disabled:dark:bg-gray-800 disabled:dark:text-gray-500",
            // focus
            focusInput,
            // remove search cancel button
            "[&::--webkit-search-cancel-button]:hidden [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden",
            inputClassName,
          )}
          {...props}
        />
        <div
          className={cx(
            // base
            "pointer-events-none absolute bottom-0 left-2 flex h-full items-center justify-center",
            // text color
            "text-gray-400 dark:text-gray-600",
          )}
        >
          <RiSearchLine
            className="size-[1.125rem] shrink-0"
            aria-hidden="true"
          />
        </div>
      </div>
    )
  },
)

Searchbar.displayName = "Searchbar"

export { Searchbar }
