"use client"

import { Button } from "@/components/Button"
import { Badge } from "@/components/Badge"
import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/Drawer"
import { Divider } from "@/components/Divider"
import { Alert } from "./columns"
import {
  RiCheckLine,
  RiCloseLine,
  RiFileCopyLine,
  RiExternalLinkLine,
} from "@remixicon/react"
import { cx } from "@/lib/utils"

interface AlertDetailsDrawerProps {
  alert: Alert | null
  open: boolean
  onOpenChange: (open: boolean) => void
  timezone: string
}

// Helper to format date/time
const formatDateTime = (dateStr: string | null, timezone: string = 'IST') => {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC'
  })
}

// Helper to format currency
const formatCurrency = (amount: number | null, currency: string | null) => {
  if (amount === null) return '-'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: 2
  }).format(amount)
}

// Get alert type display
const getAlertTypeDisplay = (alertType: string) => {
  switch (alertType) {
    case 'issuer_alert':
    case 'customerdispute_alert':
      return { name: 'Ethoca', color: 'blue' as const }
    case 'CDRN':
      return { name: 'CDRN', color: 'purple' as const }
    case 'RDR':
      return { name: 'RDR', color: 'emerald' as const }
    default:
      return { name: alertType, color: 'gray' as const }
  }
}

// Get status display
const getStatusDisplay = (status: string | null) => {
  switch (status) {
    case 'effective':
      return { name: 'Effective', color: 'emerald' as const }
    case 'invalid_order':
      return { name: 'Invalid Order', color: 'red' as const }
    case 'alert_already_refunded':
      return { name: 'Already Refunded', color: 'yellow' as const }
    case 'unable_to_refund':
      return { name: 'Unable to Refund', color: 'orange' as const }
    case 'alert_got_chargeback':
      return { name: 'Chargeback', color: 'red' as const }
    default:
      return { name: status || 'Pending', color: 'gray' as const }
  }
}

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-50 mb-3">
    {children}
  </h3>
)

const DetailRow = ({
  label,
  value,
  copyable = false,
}: {
  label: string
  value: React.ReactNode
  copyable?: boolean
}) => {
  const handleCopy = () => {
    if (typeof value === 'string') {
      navigator.clipboard.writeText(value)
    }
  }

  return (
    <div className="flex justify-between py-2 text-sm">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-gray-900 dark:text-gray-50 font-medium text-right">
          {value || '-'}
        </span>
        {copyable && value && (
          <button
            onClick={handleCopy}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <RiFileCopyLine className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

const BooleanIndicator = ({ value, label }: { value: boolean | null; label: string }) => (
  <div className="flex items-center gap-2 py-1.5">
    {value === true ? (
      <RiCheckLine className="size-4 text-emerald-500" />
    ) : value === false ? (
      <RiCloseLine className="size-4 text-red-500" />
    ) : (
      <span className="size-4 rounded-full bg-gray-200 dark:bg-gray-700" />
    )}
    <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
  </div>
)

export function AlertDetailsDrawer({
  alert,
  open,
  onOpenChange,
  timezone,
}: AlertDetailsDrawerProps) {
  if (!alert) return null

  const alertType = getAlertTypeDisplay(alert.alertType)
  const status = getStatusDisplay(alert.postAlertStatus)

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="overflow-hidden sm:max-w-lg">
        <DrawerHeader>
          <DrawerTitle>
            <div className="flex items-center gap-3">
              <Badge color={alertType.color} className="text-sm">
                {alertType.name}
              </Badge>
              <Badge color={status.color} className="text-sm">
                {status.name}
              </Badge>
            </div>
            <p className="mt-2 font-mono text-sm text-gray-500 dark:text-gray-400">
              {alert.alertId}
            </p>
          </DrawerTitle>
        </DrawerHeader>

        <DrawerBody className="-mx-6 overflow-y-auto border-t border-gray-200 px-6 dark:border-gray-800">
          {/* Alert Information */}
          <div className="py-4">
            <SectionTitle>Alert Information</SectionTitle>
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-200 dark:divide-gray-800">
              <div className="px-4">
                <DetailRow label="Alert ID" value={alert.alertId} copyable />
              </div>
              <div className="px-4">
                <DetailRow label="Alert Type" value={alertType.name} />
              </div>
              <div className="px-4">
                <DetailRow label="Category" value={alert.alertCategory} />
              </div>
              <div className="px-4">
                <DetailRow label="Alert Time" value={formatDateTime(alert.alertTimestamp, timezone)} />
              </div>
              <div className="px-4">
                <DetailRow label="Ingested At" value={formatDateTime(alert.createdAt, timezone)} />
              </div>
              <div className="px-4">
                <DetailRow label="Age" value={alert.alertAgeHours ? `${alert.alertAgeHours} hours` : null} />
              </div>
              <div className="px-4">
                <DetailRow label="Provider" value={alert.alertProvider} />
              </div>
              <div className="px-4">
                <DetailRow label="Processor" value={alert.alertProcessor} />
              </div>
            </div>
          </div>

          {/* Order Information */}
          <div className="py-4">
            <SectionTitle>Order Information</SectionTitle>
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-200 dark:divide-gray-800">
              <div className="px-4">
                <DetailRow label="Order ID" value={alert.orderId} copyable />
              </div>
              <div className="px-4">
                <DetailRow
                  label="Order Valid"
                  value={
                    alert.isOrderIdValid === true ? (
                      <span className="text-emerald-600">Yes</span>
                    ) : alert.isOrderIdValid === false ? (
                      <span className="text-red-600">No</span>
                    ) : (
                      'Unknown'
                    )
                  }
                />
              </div>
              <div className="px-4">
                <DetailRow label="Order ID Source" value={alert.orderIdSource} />
              </div>
            </div>
          </div>

          {/* Transaction Details */}
          <div className="py-4">
            <SectionTitle>Transaction Details</SectionTitle>
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-200 dark:divide-gray-800">
              <div className="px-4">
                <DetailRow label="Transaction ID" value={alert.transactionId} copyable />
              </div>
              <div className="px-4">
                <DetailRow
                  label="Amount"
                  value={formatCurrency(alert.transactionAmount, alert.transactionCurrency)}
                />
              </div>
              <div className="px-4">
                <DetailRow label="Transaction Time" value={formatDateTime(alert.transactionTimestamp, timezone)} />
              </div>
              <div className="px-4">
                <DetailRow label="Transaction Type" value={alert.transactionType} />
              </div>
              <div className="px-4">
                <DetailRow label="ARN" value={alert.arn} copyable />
              </div>
              <div className="px-4">
                <DetailRow label="Auth Code" value={alert.authCode} />
              </div>
            </div>
          </div>

          {/* Card Information */}
          <div className="py-4">
            <SectionTitle>Card Information</SectionTitle>
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-200 dark:divide-gray-800">
              <div className="px-4">
                <DetailRow label="Card Number" value={alert.cardNumberMasked} />
              </div>
              <div className="px-4">
                <DetailRow label="BIN" value={alert.cardBin} />
              </div>
              <div className="px-4">
                <DetailRow label="Last Four" value={alert.cardLastFour} />
              </div>
              <div className="px-4">
                <DetailRow label="Card Type" value={alert.cardType} />
              </div>
              <div className="px-4">
                <DetailRow label="3D Secure" value={alert.is3dSecure ? 'Yes' : 'No'} />
              </div>
            </div>
          </div>

          {/* Merchant Information */}
          <div className="py-4">
            <SectionTitle>Merchant Information</SectionTitle>
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-200 dark:divide-gray-800">
              <div className="px-4">
                <DetailRow label="Descriptor" value={alert.merchantDescriptor} />
              </div>
              <div className="px-4">
                <DetailRow label="Member Name" value={alert.merchantMemberName} />
              </div>
              <div className="px-4">
                <DetailRow label="Member ID" value={alert.memberId} />
              </div>
              <div className="px-4">
                <DetailRow label="MCC" value={alert.mcc} />
              </div>
              <div className="px-4">
                <DetailRow label="Gateway" value={alert.gatewayName} />
              </div>
              <div className="px-4">
                <DetailRow label="CRM" value={alert.crm} />
              </div>
              <div className="px-4">
                <DetailRow label="Platform" value={alert.platform} />
              </div>
            </div>
          </div>

          {/* Issuer Information */}
          <div className="py-4">
            <SectionTitle>Issuer Information</SectionTitle>
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-200 dark:divide-gray-800">
              <div className="px-4">
                <DetailRow label="Issuer" value={alert.issuer} />
              </div>
              <div className="px-4">
                <DetailRow label="Source" value={alert.source} />
              </div>
              <div className="px-4">
                <DetailRow label="Reason Code" value={alert.reasonCode} />
              </div>
              <div className="px-4">
                <DetailRow label="Reason Description" value={alert.reasonCodeDescription} />
              </div>
            </div>
          </div>

          {/* Processing Status */}
          <div className="py-4">
            <SectionTitle>Processing Status</SectionTitle>
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-4">
              <div className="grid grid-cols-2 gap-4">
                <BooleanIndicator value={alert.isOrderIdValid} label="Order Matched" />
                <BooleanIndicator value={alert.isAlreadyRefunded} label="Already Refunded" />
                <BooleanIndicator value={alert.isRefundInit} label="Refund Initiated" />
                <BooleanIndicator value={alert.isRefundCrm} label="Refund in CRM" />
                <BooleanIndicator value={alert.isAcknowledged} label="Acknowledged" />
                <BooleanIndicator value={alert.isClosed} label="Closed" />
                <BooleanIndicator value={alert.isBlacklisted} label="Blacklisted" />
                <BooleanIndicator value={alert.isFraud} label="Fraud" />
              </div>

              {alert.refundTimestampInit && (
                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-800">
                  <DetailRow label="Refund Init Time" value={formatDateTime(alert.refundTimestampInit, timezone)} />
                </div>
              )}
              {alert.refundTimestampCrm && (
                <div className="border-t border-gray-200 dark:border-gray-800">
                  <DetailRow label="Refund CRM Time" value={formatDateTime(alert.refundTimestampCrm, timezone)} />
                </div>
              )}
              {alert.acknowledgementTimestamp && (
                <div className="border-t border-gray-200 dark:border-gray-800">
                  <DetailRow label="Acknowledged Time" value={formatDateTime(alert.acknowledgementTimestamp, timezone)} />
                </div>
              )}
            </div>
          </div>

          {/* Case Information (if applicable) */}
          {(alert.caseType || alert.caseAmount) && (
            <div className="py-4">
              <SectionTitle>Case Information</SectionTitle>
              <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-200 dark:divide-gray-800">
                <div className="px-4">
                  <DetailRow label="Case Type" value={alert.caseType} />
                </div>
                <div className="px-4">
                  <DetailRow label="Case Amount" value={formatCurrency(alert.caseAmount, alert.transactionCurrency)} />
                </div>
              </div>
            </div>
          )}

          {/* Cost Information */}
          <div className="py-4">
            <SectionTitle>Cost Information</SectionTitle>
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-200 dark:divide-gray-800">
              <div className="px-4">
                <DetailRow label="Alert Cost" value={formatCurrency(alert.alertCost, 'USD')} />
              </div>
              <div className="px-4">
                <DetailRow label="Alert Price" value={formatCurrency(alert.alertPrice, 'USD')} />
              </div>
            </div>
          </div>
        </DrawerBody>

        <DrawerFooter className="-mx-6 -mb-2 gap-2 px-6 sm:justify-end">
          <DrawerClose asChild>
            <Button variant="secondary">Close</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
