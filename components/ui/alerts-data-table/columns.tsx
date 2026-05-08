"use client"

import { Badge, BadgeProps } from "@/components/Badge"
import { Checkbox } from "@/components/Checkbox"
import { ColumnDef, createColumnHelper } from "@tanstack/react-table"
import { RiCheckLine } from "@remixicon/react"
import { DataTableColumnHeader } from "./DataTableColumnHeader"

// Alert type from API
export interface Alert {
  id: number
  alertId: string
  alertType: string
  alertCategory: string | null
  alertTimestamp: string | null
  createdAt: string | null
  alertAgeHours: number | null
  merchantDescriptor: string | null
  merchantMemberName: string | null
  memberId: string | null
  mcc: string | null
  gatewayName: string | null
  transactionAmount: number
  transactionCurrency: string | null
  transactionId: string | null
  transactionTimestamp: string | null
  transactionType: string | null
  arn: string | null
  authCode: string | null
  cardBin: string | null
  cardLastFour: string | null
  cardNumberMasked: string | null
  cardType: string | null
  orderId: string | null
  orderIdSource: string | null
  isOrderIdValid: boolean | null
  crm: string | null
  isAlreadyRefunded: boolean | null
  isRefundInit: boolean | null
  refundTimestampInit: string | null
  isRefundCrm: boolean | null
  refundTimestampCrm: string | null
  isAcknowledged: boolean | null
  acknowledgementStatus: string | null
  acknowledgementTimestamp: string | null
  acknowledgementRefundStatus: string | null
  isClosed: boolean | null
  isBlacklisted: boolean | null
  isFraud: boolean | null
  postAlertStatus: string | null
  status: string | null
  platform: string | null
  source: string | null
  issuer: string | null
  is3dSecure: boolean | null
  caseType: string | null
  caseAmount: number | null
  reasonCode: string | null
  reasonCodeDescription: string | null
  alertProvider: string | null
  alertProcessor: string | null
  alertCost: number
  alertPrice: number
  dataSource: string | null
}

const columnHelper = createColumnHelper<Alert>()

// Alert type options for filtering
const alertTypes: { value: string; label: string; variant: string }[] = [
  { value: "issuer_alert", label: "Ethoca", variant: "default" },
  { value: "customerdispute_alert", label: "Ethoca", variant: "default" },
  { value: "CDRN", label: "CDRN", variant: "warning" },
  { value: "RDR", label: "RDR", variant: "success" },
]

// Status options for filtering
const statuses: { value: string; label: string; variant: string }[] = [
  { value: "effective", label: "Effective", variant: "success" },
  { value: "invalid_order", label: "Invalid Order", variant: "error" },
  { value: "alert_already_refunded", label: "Already Refunded", variant: "warning" },
  { value: "unable_to_refund", label: "Unable to Refund", variant: "neutral" },
  { value: "alert_got_chargeback", label: "Chargeback", variant: "error" },
]

// Format currency
const formatCurrency = (amount: number, currency: string | null) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: 2
  }).format(amount)
}

// Format date/time
const formatDateTime = (dateStr: string | null) => {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }) + ' ' + new Date(dateStr).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Stability indicator component
function StabilityIndicator({ hours }: { hours: number | null }) {
  if (hours === null) return <span className="text-gray-400">-</span>

  let category: 'good' | 'ok' | 'bad' | 'zero'
  if (hours === 0) {
    category = 'zero'
  } else if (hours <= 6) {
    category = 'good'
  } else if (hours <= 16) {
    category = 'ok'
  } else {
    category = 'bad'
  }

  const getBarClass = (index: number) => {
    if (category === 'zero') {
      return 'bg-gray-300 dark:bg-gray-800'
    } else if (category === 'good') {
      return 'bg-blue-600 dark:bg-blue-500'
    } else if (category === 'ok' && index < 2) {
      return 'bg-blue-600 dark:bg-blue-500'
    } else if (category === 'bad' && index < 1) {
      return 'bg-blue-600 dark:bg-blue-500'
    }
    return 'bg-gray-300 dark:bg-gray-800'
  }

  return (
    <div className="flex items-center gap-0.5">
      <span className="w-6 tabular-nums">{hours}</span>
      <div className="flex gap-0.5">
        <div className={`h-3.5 w-1 rounded-sm ${getBarClass(0)}`} />
        <div className={`h-3.5 w-1 rounded-sm ${getBarClass(1)}`} />
        <div className={`h-3.5 w-1 rounded-sm ${getBarClass(2)}`} />
      </div>
    </div>
  )
}

export const columns = [
  // Checkbox column
  columnHelper.display({
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected()
            ? true
            : table.getIsSomeRowsSelected()
              ? "indeterminate"
              : false
        }
        onCheckedChange={() => table.toggleAllPageRowsSelected()}
        className="translate-y-0.5"
        aria-label="Select all"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={() => row.toggleSelected()}
        onClick={(e) => e.stopPropagation()}
        className="translate-y-0.5"
        aria-label="Select row"
      />
    ),
    enableSorting: false,
    enableHiding: false,
    meta: {
      displayName: "Select",
    },
  }),

  // ===== DEFAULT VISIBLE COLUMNS =====

  // 1. Descriptor
  columnHelper.accessor("merchantDescriptor", {
    id: "merchantDescriptor",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Descriptor" />
    ),
    enableSorting: true,
    enableHiding: false,
    meta: {
      className: "text-left",
      displayName: "Descriptor",
    },
    cell: ({ getValue }) => (
      <span className="font-medium text-gray-900 dark:text-gray-50 max-w-[180px] truncate block">
        {getValue() || '-'}
      </span>
    ),
    filterFn: "arrIncludesSome",
  }),

  // 2. Order ID
  columnHelper.accessor("orderId", {
    id: "orderId",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Order ID" />
    ),
    enableSorting: true,
    enableHiding: true,
    meta: {
      className: "text-left",
      displayName: "Order ID",
    },
    cell: ({ getValue }) => {
      const value = getValue()
      return (
        <span className="text-gray-700 dark:text-gray-300">
          {value || '-'}
        </span>
      )
    },
  }),

  // 3. Amount
  columnHelper.accessor("transactionAmount", {
    id: "transactionAmount",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Amount" />
    ),
    enableSorting: true,
    enableHiding: true,
    meta: {
      className: "text-right",
      displayName: "Amount",
    },
    cell: ({ row }) => (
      <span className="font-medium tabular-nums text-gray-900 dark:text-gray-50">
        {formatCurrency(row.original.transactionAmount, row.original.transactionCurrency)}
      </span>
    ),
  }),

  // 4. Alert Received Date (alertTimestamp)
  columnHelper.accessor("alertTimestamp", {
    id: "alertTimestamp",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Received" />
    ),
    enableSorting: true,
    enableHiding: true,
    meta: {
      className: "tabular-nums text-gray-600 dark:text-gray-400",
      displayName: "Received",
    },
    cell: ({ getValue }) => (
      <span className="text-gray-600 dark:text-gray-400">
        {formatDateTime(getValue())}
      </span>
    ),
  }),

  // 5. Transaction Date
  columnHelper.accessor("transactionTimestamp", {
    id: "transactionTimestamp",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Txn Date" />
    ),
    enableSorting: true,
    enableHiding: true,
    meta: {
      className: "tabular-nums text-gray-600 dark:text-gray-400",
      displayName: "Txn Date",
    },
    cell: ({ getValue }) => (
      <span className="text-gray-600 dark:text-gray-400">
        {formatDateTime(getValue())}
      </span>
    ),
  }),

  // 6. Alert Type
  columnHelper.accessor("alertType", {
    id: "alertType",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Type" />
    ),
    enableSorting: true,
    enableHiding: true,
    meta: {
      className: "text-left",
      displayName: "Type",
    },
    cell: ({ getValue }) => {
      const value = getValue()
      const type = alertTypes.find(t => t.value === value)
      return (
        <Badge variant={type?.variant as BadgeProps["variant"] || "default"}>
          {type?.label || value}
        </Badge>
      )
    },
    filterFn: (row, id, filterValues) => {
      if (!filterValues || (Array.isArray(filterValues) && filterValues.length === 0)) {
        return true
      }
      const alertType = row.getValue(id) as string
      const values = Array.isArray(filterValues) ? filterValues : [filterValues]

      return values.some((value: string) => {
        if (value === "ethoca") {
          return alertType === "issuer_alert" || alertType === "customerdispute_alert"
        }
        if (value === "cdrn") return alertType === "CDRN"
        if (value === "rdr") return alertType === "RDR"
        return false
      })
    },
  }),

  // 7. Status
  columnHelper.accessor("postAlertStatus", {
    id: "postAlertStatus",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    enableSorting: true,
    enableHiding: true,
    meta: {
      className: "text-left",
      displayName: "Status",
    },
    cell: ({ getValue }) => {
      const value = getValue()
      const status = statuses.find(s => s.value === value)
      return (
        <Badge variant={status?.variant as BadgeProps["variant"] || "neutral"}>
          {status?.label || value || 'Pending'}
        </Badge>
      )
    },
    filterFn: "arrIncludesSome",
  }),

  // 8. Refunded (checkmark if refunded)
  columnHelper.accessor("isRefundCrm", {
    id: "isRefundCrm",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Refunded" />
    ),
    enableSorting: true,
    enableHiding: true,
    meta: {
      className: "text-center",
      displayName: "Refunded",
    },
    cell: ({ row }) => {
      const isRefunded = row.original.isRefundCrm || row.original.isAlreadyRefunded
      return isRefunded ? (
        <RiCheckLine className="size-4 text-emerald-600 dark:text-emerald-500 mx-auto" />
      ) : null
    },
  }),

  // ===== HIDDEN BY DEFAULT (available in View) =====

  // Alert ID
  columnHelper.accessor("alertId", {
    id: "alertId",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Alert ID" />
    ),
    enableSorting: true,
    enableHiding: true,
    meta: {
      className: "text-left",
      displayName: "Alert ID",
    },
    cell: ({ getValue }) => {
      const value = getValue()
      return (
        <span className="text-gray-600 dark:text-gray-400">
          {value || '-'}
        </span>
      )
    },
  }),

  // Age (Stability-style indicator)
  columnHelper.accessor("alertAgeHours", {
    id: "alertAgeHours",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Age (hrs)" />
    ),
    enableSorting: true,
    enableHiding: true,
    meta: {
      className: "text-left",
      displayName: "Age",
    },
    cell: ({ getValue }) => <StabilityIndicator hours={getValue()} />,
  }),

  // Ingested At
  columnHelper.accessor("createdAt", {
    id: "createdAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Ingested" />
    ),
    enableSorting: true,
    enableHiding: true,
    meta: {
      className: "tabular-nums",
      displayName: "Ingested",
    },
    cell: ({ getValue }) => (
      <span className="text-gray-600 dark:text-gray-400">
        {formatDateTime(getValue())}
      </span>
    ),
  }),

  // Issuer
  columnHelper.accessor("issuer", {
    id: "issuer",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Issuer" />
    ),
    enableSorting: true,
    enableHiding: true,
    meta: {
      className: "text-left max-w-[150px] truncate",
      displayName: "Issuer",
    },
    cell: ({ getValue }) => getValue() || '-',
  }),

  // Gateway
  columnHelper.accessor("gatewayName", {
    id: "gatewayName",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Gateway" />
    ),
    enableSorting: true,
    enableHiding: true,
    meta: {
      className: "text-left",
      displayName: "Gateway",
    },
    cell: ({ getValue }) => getValue() || '-',
  }),

  // Card Type
  columnHelper.accessor("cardType", {
    id: "cardType",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Card Type" />
    ),
    enableSorting: true,
    enableHiding: true,
    meta: {
      className: "text-left",
      displayName: "Card Type",
    },
    cell: ({ getValue }) => getValue() || '-',
  }),

  // Card Last Four
  columnHelper.accessor("cardLastFour", {
    id: "cardLastFour",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Card" />
    ),
    enableSorting: true,
    enableHiding: true,
    meta: {
      className: "text-left font-mono",
      displayName: "Card",
    },
    cell: ({ getValue }) => {
      const value = getValue()
      return value ? `****${value}` : '-'
    },
  }),

  // ARN
  columnHelper.accessor("arn", {
    id: "arn",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="ARN" />
    ),
    enableSorting: true,
    enableHiding: true,
    meta: {
      className: "text-left font-mono text-xs",
      displayName: "ARN",
    },
    cell: ({ getValue }) => {
      const value = getValue()
      return value ? (value.length > 16 ? `${value.slice(0, 16)}...` : value) : '-'
    },
  }),

  // Reason Code
  columnHelper.accessor("reasonCode", {
    id: "reasonCode",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Reason" />
    ),
    enableSorting: true,
    enableHiding: true,
    meta: {
      className: "text-left",
      displayName: "Reason Code",
    },
    cell: ({ getValue }) => getValue() || '-',
  }),

  // MCC
  columnHelper.accessor("mcc", {
    id: "mcc",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="MCC" />
    ),
    enableSorting: true,
    enableHiding: true,
    meta: {
      className: "text-left",
      displayName: "MCC",
    },
    cell: ({ getValue }) => getValue() || '-',
  }),

] as ColumnDef<Alert>[]
