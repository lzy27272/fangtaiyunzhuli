export const permissions = Object.freeze({
  dailyReport: {
    readOwn: 'daily-report.read',
    editOwn: 'daily-report.submit',
    submit: 'daily-report.submit',
    readTeam: 'daily-report.team-read',
    reviewException: 'daily-report.review',
    reviewCorrection: 'daily-report.revision-review',
  },
  dailyReportTemplate: {
    read: 'daily-report-template.read',
    create: 'daily-report-template.manage',
    edit: 'daily-report-template.manage',
    review: 'daily-report-template.review',
    publish: 'daily-report-template.publish',
    retire: 'daily-report-template.publish',
    supplement: 'daily-report-template.store-supplement',
  },
  dailyOperations: {
    readHotel: 'daily-operation.read',
    readCrossHotel: 'daily-operation.cross-hotel-read',
    confirmIssue: 'issue.confirm',
    assignIssue: 'issue.assign',
    closeIssue: 'issue.close',
    reopenIssue: 'issue.reopen',
    retrySnapshot: 'operation-snapshot.retry',
  },
  taskCandidate: {
    read: 'task-candidate.read',
    edit: 'task-candidate.manage',
    confirm: 'task-candidate.confirm',
    reject: 'task-candidate.reject',
    retry: 'task-candidate.retry',
  },
  evidence: {
    read: 'daily-report.read',
    readSensitive: 'evidence.sensitive.read',
    upload: 'daily-report.submit',
    invalidate: 'daily-report.submit',
  },
  snapshot: {
    read: 'operation-snapshot.read',
    compare: 'operation-snapshot.compare',
  },
  export: {
    create: 'operation-export.create',
    download: 'operation-export.download',
    sensitive: 'operation-export.sensitive',
  },
  ai: {
    read: 'ai-recommendation.read',
    feedback: 'ai-recommendation.feedback',
    adopt: 'ai-recommendation.adopt',
  },
})

export function hasPermission(granted: string[], permission: string): boolean {
  return granted.includes('*') || granted.includes(permission)
}

export function hasAnyPermission(granted: string[], required: readonly string[]): boolean {
  return required.length === 0 || granted.includes('*') || required.some((permission) => granted.includes(permission))
}

export function hasAllPermissions(granted: string[], required: readonly string[]): boolean {
  return required.length === 0 || granted.includes('*') || required.every((permission) => granted.includes(permission))
}
