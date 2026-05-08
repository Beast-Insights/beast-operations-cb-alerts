export type AlertSeverity = 'critical' | 'warning' | 'info'

export type AlertType =
  | 'data_source_offline'
  | 'sla_breach_imminent'
  | 'ethoca_ack_delay'
  | 'refund_processing_delay'
  | 'volume_anomaly'
  | 'order_matching_degradation'
  | 'overall_effectiveness_low'
  | 'descriptor_effectiveness_drop'

export type DataSourceStatusType = 'healthy' | 'warning' | 'critical'

export interface DataSourceStatus {
  source: 'RDR' | 'Ethoca' | 'CDRN'
  lastIngested: string | null
  alertTimestamp: string | null
  minutesAgo: number | null
  status: DataSourceStatusType
}

export interface Alert {
  id: string
  type: AlertType
  severity: AlertSeverity
  message: string
  details: string
  createdAt: string
  dismissible: boolean
  actionLabel?: string
  actionUrl?: string
  metadata?: Record<string, any>
}

export interface OperationsAlertsResponse {
  timestamp: string
  timezone: string
  dataSourceStatus: {
    rdr: DataSourceStatus
    ethoca: DataSourceStatus
    cdrn: DataSourceStatus
  }
  alerts: {
    critical: Alert[]
    warning: Alert[]
    info: Alert[]
  }
  counts: {
    critical: number
    warning: number
    info: number
    total: number
  }
}

export interface DismissedAlert {
  alertId: string
  dismissedAt: string
}
