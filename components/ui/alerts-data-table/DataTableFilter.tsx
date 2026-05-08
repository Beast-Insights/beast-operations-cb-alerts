"use client"

import {
  RiAddLine,
  RiArrowDownSLine,
  RiSearchLine,
} from "@remixicon/react"
import { Column } from "@tanstack/react-table"

import { Button } from "@/components/Button"
import { Checkbox } from "@/components/Checkbox"
import { Label } from "@/components/Label"
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/Popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/Select"
import { cx, focusRing } from "@/lib/utils"
import React from "react"

type FilterType = "select" | "checkbox" | "searchable-list"

interface DataTableFilterProps<TData, TValue> {
  column: Column<TData, TValue> | undefined
  title?: string
  options?: {
    label: string
    value: string
  }[]
  type?: FilterType
  placeholder?: string
}

const ColumnFiltersLabel = ({
  columnFilterLabels,
  className,
}: {
  columnFilterLabels: string[] | undefined
  className?: string
}) => {
  if (!columnFilterLabels) return null

  if (columnFilterLabels.length < 3) {
    return (
      <span className={cx("truncate", className)}>
        {columnFilterLabels.map((value, index) => (
          <span
            key={value}
            className={cx("font-semibold text-blue-600 dark:text-blue-400")}
          >
            {value}
            {index < columnFilterLabels.length - 1 && ", "}
          </span>
        ))}
      </span>
    )
  }

  return (
    <span
      className={cx(
        "font-semibold text-blue-600 dark:text-blue-400",
        className,
      )}
    >
      {columnFilterLabels.length} selected
    </span>
  )
}

type FilterValues = string | string[] | undefined

export function DataTableFilter<TData, TValue>({
  column,
  title,
  options,
  type = "select",
  placeholder,
}: DataTableFilterProps<TData, TValue>) {
  const columnFilters = column?.getFilterValue() as FilterValues

  const [selectedValues, setSelectedValues] =
    React.useState<FilterValues>(columnFilters)

  const [searchQuery, setSearchQuery] = React.useState("")

  const columnFilterLabels = React.useMemo(() => {
    if (!selectedValues) return undefined

    if (Array.isArray(selectedValues)) {
      if (selectedValues.length === 0) return undefined
      return selectedValues.map((value) => {
        const option = options?.find((o) => o.value === value)
        return option?.label || value
      })
    }

    if (typeof selectedValues === "string" && selectedValues !== "") {
      const option = options?.find((o) => o.value === selectedValues)
      return [option?.label || selectedValues]
    }

    return undefined
  }, [selectedValues, options])

  // Filter options based on search query
  const filteredOptions = React.useMemo(() => {
    if (!options) return []
    if (!searchQuery) return options
    return options.filter(option =>
      option.label.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [options, searchQuery])

  const getDisplayedFilter = () => {
    switch (type) {
      case "searchable-list":
        return (
          <div className="mt-2 space-y-2">
            {/* Search input */}
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={placeholder || `Search ${title}...`}
                className={cx(
                  "w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-3 text-sm text-gray-900 placeholder-gray-400 outline-none",
                  "focus:border-blue-500 focus:ring-2 focus:ring-blue-200",
                  "dark:border-gray-700 dark:bg-gray-950 dark:text-gray-50 dark:placeholder-gray-500",
                  "dark:focus:border-blue-700 dark:focus:ring-blue-700/30"
                )}
              />
              <RiSearchLine
                className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-gray-400"
                aria-hidden="true"
              />
            </div>
            {/* Checkbox list */}
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {filteredOptions.length > 0 ? (
                filteredOptions.map((option) => (
                  <div key={option.value} className="flex items-center gap-2 py-1">
                    <Checkbox
                      id={option.value}
                      checked={(selectedValues as string[])?.includes(option.value)}
                      onCheckedChange={(checked) => {
                        setSelectedValues((prev) => {
                          if (checked) {
                            return prev
                              ? [...(prev as string[]), option.value]
                              : [option.value]
                          } else {
                            return (prev as string[])?.filter(
                              (value) => value !== option.value,
                            ) || []
                          }
                        })
                      }}
                    />
                    <Label
                      htmlFor={option.value}
                      className="text-sm cursor-pointer truncate"
                    >
                      {option.label}
                    </Label>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500 py-2">No results found</p>
              )}
            </div>
          </div>
        )
      case "select":
        return (
          <Select
            value={selectedValues as string}
            onValueChange={(value) => {
              setSelectedValues(value)
            }}
          >
            <SelectTrigger className="mt-2 sm:py-1">
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              {options?.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      case "checkbox":
        return (
          <div className="mt-2 space-y-2 overflow-y-auto sm:max-h-36">
            {options?.map((option) => {
              return (
                <div key={option.label} className="flex items-center gap-2">
                  <Checkbox
                    id={option.value}
                    checked={(selectedValues as string[])?.includes(
                      option.value,
                    )}
                    onCheckedChange={(checked) => {
                      setSelectedValues((prev) => {
                        if (checked) {
                          return prev
                            ? [...(prev as string[]), option.value]
                            : [option.value]
                        } else {
                          return (prev as string[]).filter(
                            (value) => value !== option.value,
                          )
                        }
                      })
                    }}
                  />
                  <Label
                    htmlFor={option.value}
                    className="text-base sm:text-sm"
                  >
                    {option.label}
                  </Label>
                </div>
              )
            })}
          </div>
        )
    }
  }

  React.useEffect(() => {
    setSelectedValues(columnFilters)
  }, [columnFilters])

  // Reset search when popover closes
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setSearchQuery("")
    }
  }

  return (
    <Popover onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cx(
            "flex w-full items-center gap-x-1.5 whitespace-nowrap rounded-md border border-gray-300 px-2 py-1.5 font-medium text-gray-600 hover:bg-gray-50 sm:w-fit sm:text-xs dark:border-gray-700 dark:text-gray-400 hover:dark:bg-gray-900",
            selectedValues &&
              ((typeof selectedValues === "string" && selectedValues !== "") ||
                (Array.isArray(selectedValues) && selectedValues.length > 0))
              ? ""
              : "border-dashed",
            focusRing,
          )}
        >
          <span
            aria-hidden="true"
            onClick={(e) => {
              if (selectedValues &&
                ((typeof selectedValues === "string" && selectedValues !== "") ||
                 (Array.isArray(selectedValues) && selectedValues.length > 0))) {
                e.stopPropagation()
                column?.setFilterValue(type === "searchable-list" || type === "checkbox" ? [] : "")
                setSelectedValues(type === "searchable-list" || type === "checkbox" ? [] : "")
              }
            }}
          >
            <RiAddLine
              className={cx(
                "-ml-px size-5 shrink-0 transition sm:size-4",
                selectedValues &&
                  ((typeof selectedValues === "string" && selectedValues !== "") ||
                   (Array.isArray(selectedValues) && selectedValues.length > 0)) &&
                  "rotate-45 hover:text-red-500",
              )}
              aria-hidden="true"
            />
          </span>
          {columnFilterLabels && columnFilterLabels.length > 0 ? (
            <span>{title}</span>
          ) : (
            <span className="w-full text-left sm:w-fit">{title}</span>
          )}
          {columnFilterLabels && columnFilterLabels.length > 0 && (
            <span
              className="h-4 w-px bg-gray-300 dark:bg-gray-700"
              aria-hidden="true"
            />
          )}
          <ColumnFiltersLabel
            columnFilterLabels={columnFilterLabels}
            className="w-full text-left sm:w-fit max-w-[100px] truncate"
          />
          <RiArrowDownSLine
            className="size-5 shrink-0 text-gray-500 sm:size-4"
            aria-hidden="true"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={7}
        className={cx(
          "sm:min-w-56 sm:max-w-72",
          type === "searchable-list" ? "min-w-64 max-w-72" : "min-w-[calc(var(--radix-popover-trigger-width))] max-w-[calc(var(--radix-popover-trigger-width))]"
        )}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            column?.setFilterValue(selectedValues)
          }}
        >
          <div className="space-y-2">
            <div>
              <Label className="text-base font-medium sm:text-sm">
                Filter by {title}
              </Label>
              {getDisplayedFilter()}
            </div>
            <PopoverClose className="w-full" asChild>
              <Button type="submit" className="w-full sm:py-1">
                Apply
              </Button>
            </PopoverClose>
            {columnFilterLabels && columnFilterLabels.length > 0 && (
              <Button
                variant="secondary"
                className="w-full sm:py-1"
                type="button"
                onClick={() => {
                  column?.setFilterValue(type === "searchable-list" || type === "checkbox" ? [] : "")
                  setSelectedValues(type === "searchable-list" || type === "checkbox" ? [] : "")
                }}
              >
                Reset
              </Button>
            )}
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
