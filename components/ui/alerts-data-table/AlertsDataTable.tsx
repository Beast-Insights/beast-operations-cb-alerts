"use client"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/Table"
import { Button } from "@/components/Button"
import { cx } from "@/lib/utils"
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import React, { useState, useEffect, useCallback, useMemo } from "react"
import { RiDownloadLine, RiEqualizer2Line } from "@remixicon/react"
import { DataTablePagination } from "./DataTablePagination"
import { DataTableFilter } from "./DataTableFilter"
import { Alert, columns } from "./columns"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/Popover"
import { Checkbox } from "@/components/Checkbox"
import { Label } from "@/components/Label"

// Filter options
const alertTypeOptions = [
  { value: "ethoca", label: "Ethoca" },
  { value: "cdrn", label: "CDRN" },
  { value: "rdr", label: "RDR" },
]

const statusOptions = [
  { value: "effective", label: "Effective" },
  { value: "invalid_order", label: "Invalid Order" },
  { value: "alert_already_refunded", label: "Already Refunded" },
  { value: "unable_to_refund", label: "Unable to Refund" },
  { value: "alert_got_chargeback", label: "Chargeback" },
]

interface AlertsDataTableProps {
  startDate: string
  endDate: string
  timezone: string
  dateColumn?: 'created_at' | 'alert_timestamp'
  onRowClick?: (alert: Alert) => void
}

export function AlertsDataTable({
  startDate,
  endDate,
  timezone,
  dateColumn = 'alert_timestamp', // Default to alert_timestamp for accurate billing
  onRowClick,
}: AlertsDataTableProps) {
  const pageSize = 20
  const [data, setData] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingProgress, setLoadingProgress] = useState('')
  const [rowSelection, setRowSelection] = useState({})

  const table = useReactTable({
    data,
    columns,
    state: {
      rowSelection,
    },
    initialState: {
      pagination: {
        pageIndex: 0,
        pageSize: pageSize,
      },
      sorting: [{ id: 'alertTimestamp', desc: true }],
      columnVisibility: {
        // Hidden by default - available in View
        alertId: false,
        alertAgeHours: false,
        createdAt: false,
        issuer: false,
        gatewayName: false,
        cardType: false,
        cardLastFour: false,
        arn: false,
        reasonCode: false,
        mcc: false,
      },
    },
    enableRowSelection: true,
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const isFiltered = table.getState().columnFilters.length > 0

  // Extract unique descriptors from data for the filter
  const descriptorOptions = useMemo(() => {
    const descriptorSet = new Set(data.map(alert => alert.merchantDescriptor).filter(Boolean))
    const uniqueDescriptors = Array.from(descriptorSet) as string[]
    return uniqueDescriptors.sort().map(descriptor => ({
      label: descriptor,
      value: descriptor,
    }))
  }, [data])

  // Fetch all alerts from API (handles pagination automatically)
  const fetchAlerts = useCallback(async () => {
    setLoading(true)
    setLoadingProgress('Fetching alerts...')
    try {
      const allAlerts: Alert[] = []
      let offset = 0
      const batchSize = 1000
      let hasMore = true
      let totalCount = 0

      // Fetch all pages
      while (hasMore) {
        const params = new URLSearchParams({
          startDate,
          endDate,
          timezone,
          dateColumn,
          limit: String(batchSize),
          offset: String(offset),
        })

        const response = await fetch(`/api/alerts?${params.toString()}`, {
          cache: 'no-store'
        })

        if (!response.ok) throw new Error('Failed to fetch alerts')

        const result = await response.json()
        const alerts = result.alerts || []
        allAlerts.push(...alerts)

        // Get total from first response
        if (offset === 0 && result.pagination?.total) {
          totalCount = result.pagination.total
        }

        // Update progress
        if (totalCount > 0) {
          setLoadingProgress(`Loading ${allAlerts.length.toLocaleString()} of ${totalCount.toLocaleString()} alerts...`)
        } else {
          setLoadingProgress(`Loading ${allAlerts.length.toLocaleString()} alerts...`)
        }

        // Check if there are more results
        hasMore = result.pagination?.hasMore ?? false
        offset += batchSize

        // Safety limit to prevent infinite loops (max 50,000 alerts)
        if (offset >= 50000) break
      }

      setData(allAlerts)
    } catch (error) {
      console.error('Error fetching alerts:', error)
      setData([])
    } finally {
      setLoading(false)
      setLoadingProgress('')
    }
  }, [startDate, endDate, timezone, dateColumn])

  useEffect(() => {
    fetchAlerts()
  }, [fetchAlerts])

  // Export functionality - exports filtered data when filters are applied
  const handleExport = () => {
    // Get filtered rows if filters are applied, otherwise use all data
    const exportData = isFiltered
      ? table.getFilteredRowModel().rows.map(row => row.original)
      : data

    const headers = ['Alert ID', 'Type', 'Ingested At', 'Order ID', 'Amount', 'Merchant', 'Status']
    const csvContent = [
      headers.join(','),
      ...exportData.map(alert => [
        alert.alertId,
        alert.alertType,
        alert.createdAt || '',
        alert.orderId || '',
        alert.transactionAmount,
        `"${(alert.merchantDescriptor || '').replace(/"/g, '""')}"`,
        alert.postAlertStatus || ''
      ].join(','))
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `alerts-${startDate}-to-${endDate}${isFiltered ? '-filtered' : ''}.csv`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-3">
      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-x-6">
        <div className="flex w-full flex-col gap-2 sm:w-fit sm:flex-row sm:items-center">
          <DataTableFilter
            column={table.getColumn("merchantDescriptor")}
            title="Descriptor"
            options={descriptorOptions}
            type="searchable-list"
            placeholder="Search descriptors..."
          />
          {table.getColumn("alertType")?.getIsVisible() && (
            <DataTableFilter
              column={table.getColumn("alertType")}
              title="Type"
              options={alertTypeOptions}
              type="checkbox"
            />
          )}
          {table.getColumn("postAlertStatus")?.getIsVisible() && (
            <DataTableFilter
              column={table.getColumn("postAlertStatus")}
              title="Status"
              options={statusOptions}
              type="checkbox"
            />
          )}
          {isFiltered && (
            <Button
              variant="ghost"
              onClick={() => {
                table.resetColumnFilters()
              }}
              className="border border-gray-200 px-2 font-semibold text-blue-600 sm:border-none sm:py-1 dark:border-gray-800 dark:text-blue-500"
            >
              Clear filters
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={handleExport}
            className="hidden gap-x-2 px-2 py-1.5 text-sm sm:text-xs lg:flex"
          >
            <RiDownloadLine className="size-4 shrink-0" aria-hidden="true" />
            Export
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="secondary"
                className="hidden gap-x-2 px-2 py-1.5 text-sm sm:text-xs lg:flex"
              >
                <RiEqualizer2Line className="size-4" aria-hidden="true" />
                View
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={7} className="z-50 w-fit space-y-2">
              <Label className="font-medium">Display columns</Label>
              <div className="flex flex-col gap-2">
                {table.getAllColumns().map((column) => {
                  if (!column.getCanHide()) return null
                  return (
                    <div key={column.id} className="flex items-center gap-2">
                      <Checkbox
                        id={column.id}
                        checked={column.getIsVisible()}
                        onCheckedChange={() => column.toggleVisibility()}
                      />
                      <Label htmlFor={column.id} className="text-sm">
                        {(column.columnDef.meta as any)?.displayName || column.id}
                      </Label>
                    </div>
                  )
                })}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Table */}
      <div className="relative overflow-hidden overflow-x-auto">
        <Table>
          <TableHead>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow
                key={headerGroup.id}
                className="border-y border-gray-200 dark:border-gray-800"
              >
                {headerGroup.headers.map((header) => (
                  <TableHeaderCell
                    key={header.id}
                    className={cx(
                      "whitespace-nowrap py-2.5 text-sm sm:text-xs",
                      (header.column.columnDef.meta as any)?.className,
                    )}
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
                  </TableHeaderCell>
                ))}
              </TableRow>
            ))}
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  {loadingProgress || 'Loading alerts...'}
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  onClick={() => {
                    row.toggleSelected(!row.getIsSelected())
                    onRowClick?.(row.original)
                  }}
                  className="group select-none hover:bg-gray-50 hover:dark:bg-gray-900"
                >
                  {row.getVisibleCells().map((cell, index) => (
                    <TableCell
                      key={cell.id}
                      className={cx(
                        row.getIsSelected()
                          ? "bg-gray-50 dark:bg-gray-900"
                          : "",
                        "relative whitespace-nowrap py-2.5 text-gray-600 first:w-10 dark:text-gray-400",
                        (cell.column.columnDef.meta as any)?.className,
                      )}
                    >
                      {index === 0 && row.getIsSelected() && (
                        <div className="absolute inset-y-0 left-0 w-0.5 bg-blue-600 dark:bg-blue-500" />
                      )}
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <DataTablePagination table={table} pageSize={pageSize} />
    </div>
  )
}
