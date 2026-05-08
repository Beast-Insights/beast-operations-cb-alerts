'use client'

import * as React from 'react'
import * as Popover from '@radix-ui/react-popover'
import { RiCalendar2Fill } from '@remixicon/react'
import { format } from 'date-fns'
import { DayPicker, DateRange } from 'react-day-picker'
import { cx } from '@/lib/cx'
import { Button } from './Button'

interface DateRangePickerProps {
  value?: DateRange
  onChange?: (range: DateRange | undefined) => void
  className?: string
  placeholder?: string
  disabled?: boolean
  align?: 'start' | 'center' | 'end'
}

function formatDateDisplay(date: Date): string {
  return format(date, 'dd MMM, yyyy')
}

export function DateRangePicker({
  value,
  onChange,
  className,
  placeholder = 'Select date range',
  disabled = false,
  align = 'start',
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false)
  const [range, setRange] = React.useState<DateRange | undefined>(value)
  const [month, setMonth] = React.useState<Date | undefined>(value?.from)

  // Store initial range when opening to enable cancel
  const initialRangeRef = React.useRef<DateRange | undefined>(value)

  React.useEffect(() => {
    setRange(value)
    if (value?.from) {
      setMonth(value.from)
    }
  }, [value])

  React.useEffect(() => {
    if (open) {
      initialRangeRef.current = range
    }
  }, [open])

  const handleSelect = (newRange: DateRange | undefined) => {
    setRange(newRange)
  }

  const handleApply = () => {
    onChange?.(range)
    setOpen(false)
  }

  const handleCancel = () => {
    setRange(initialRangeRef.current)
    setOpen(false)
  }

  const displayValue = React.useMemo(() => {
    if (!range?.from) return null
    if (!range.to) return formatDateDisplay(range.from)
    return `${formatDateDisplay(range.from)} - ${formatDateDisplay(range.to)}`
  }, [range])

  const rangeDisplayText = React.useMemo(() => {
    if (!range?.from) return ''
    if (!range.to) return formatDateDisplay(range.from)
    return `${formatDateDisplay(range.from)} - ${formatDateDisplay(range.to)}`
  }, [range])

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cx(
            // base
            'flex w-full cursor-pointer items-center gap-x-2 truncate rounded-md border px-3 py-2 shadow-sm outline-none transition-all sm:text-sm',
            // background color
            'bg-white dark:bg-gray-950',
            // border color
            'border-gray-300 dark:border-gray-800',
            // text color
            'text-gray-900 dark:text-gray-50',
            // hover
            'hover:bg-gray-50 hover:dark:bg-gray-950/50',
            // focus
            'focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:focus:border-blue-500 dark:focus:ring-blue-500/20',
            // disabled
            'disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400',
            'disabled:dark:border-gray-800 disabled:dark:bg-gray-800 disabled:dark:text-gray-500',
            className
          )}
        >
          <RiCalendar2Fill className="size-5 shrink-0 text-gray-400 dark:text-gray-600" />
          <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left">
            {displayValue ? (
              displayValue
            ) : (
              <span className="text-gray-400 dark:text-gray-600">{placeholder}</span>
            )}
          </span>
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align={align}
          sideOffset={10}
          className={cx(
            // base
            'z-50 rounded-md border text-sm shadow-xl shadow-black/[2.5%]',
            // border color
            'border-gray-200 dark:border-gray-800',
            // background color
            'bg-white dark:bg-gray-950',
            // animation
            'will-change-[transform,opacity]',
            'data-[state=closed]:animate-hide',
            'data-[state=open]:animate-slideDownAndFade'
          )}
        >
          <div className="overflow-x-auto p-3">
            <DayPicker
              mode="range"
              selected={range}
              onSelect={handleSelect}
              month={month}
              onMonthChange={setMonth}
              numberOfMonths={2}
              showOutsideDays
              weekStartsOn={1}
              classNames={{
                months: 'flex flex-row divide-x divide-gray-200 dark:divide-gray-800',
                month: 'px-3 first:pl-0 last:pr-0',
                caption: 'flex justify-center py-2 relative items-center',
                caption_label: 'text-sm font-medium text-gray-900 dark:text-gray-50',
                nav: 'flex items-center',
                nav_button: cx(
                  'inline-flex size-7 items-center justify-center rounded-md p-0',
                  'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
                  'dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-50',
                  'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1'
                ),
                nav_button_previous: 'absolute left-0',
                nav_button_next: 'absolute right-0',
                table: 'w-full border-collapse',
                head_row: 'flex',
                head_cell: 'w-9 text-center text-xs font-medium text-gray-500 dark:text-gray-500 py-2',
                row: 'flex w-full mt-1',
                cell: cx(
                  'relative p-0 text-center text-sm focus-within:relative focus-within:z-20',
                  '[&:has([aria-selected])]:bg-blue-50 dark:[&:has([aria-selected])]:bg-blue-950/30',
                  '[&:has([aria-selected].day-range-end)]:rounded-r-md',
                  '[&:has([aria-selected].day-range-start)]:rounded-l-md',
                  'first:[&:has([aria-selected])]:rounded-l-md',
                  'last:[&:has([aria-selected])]:rounded-r-md'
                ),
                day: cx(
                  'inline-flex size-9 items-center justify-center rounded-md p-0 text-sm font-normal',
                  'text-gray-900 hover:bg-gray-100 dark:text-gray-50 dark:hover:bg-gray-800',
                  'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1',
                  'aria-selected:opacity-100'
                ),
                day_range_start: 'day-range-start !bg-blue-500 !text-white hover:!bg-blue-600 dark:!bg-blue-500 dark:!text-white rounded-l-md',
                day_range_end: 'day-range-end !bg-blue-500 !text-white hover:!bg-blue-600 dark:!bg-blue-500 dark:!text-white rounded-r-md',
                day_selected: '!bg-blue-500 !text-white hover:!bg-blue-600 dark:!bg-blue-500 dark:!text-white',
                day_today: 'font-semibold',
                day_outside: 'text-gray-400 opacity-50 dark:text-gray-600 aria-selected:bg-blue-50/50 aria-selected:text-gray-500',
                day_disabled: 'text-gray-400 opacity-50 dark:text-gray-600',
                day_range_middle: 'aria-selected:bg-blue-50 aria-selected:text-blue-900 dark:aria-selected:bg-blue-950/30 dark:aria-selected:text-blue-100',
                day_hidden: 'invisible',
              }}
            />
          </div>

          {/* Footer with range display and buttons */}
          <div className="flex items-center justify-between border-t border-gray-200 px-3 py-3 dark:border-gray-800">
            <p className="text-sm tabular-nums text-gray-900 dark:text-gray-50">
              <span className="text-gray-500 dark:text-gray-400">Range:</span>{' '}
              <span className="font-medium">{rangeDisplayText || '—'}</span>
            </p>
            <div className="flex items-center gap-x-2">
              <Button
                variant="secondary"
                className="h-8 px-3 text-sm"
                type="button"
                onClick={handleCancel}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                className="h-8 px-3 text-sm"
                type="button"
                onClick={handleApply}
              >
                Apply
              </Button>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export type { DateRange }
