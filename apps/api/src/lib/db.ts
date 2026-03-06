export type SqlValue = string | number | null

export interface SqlAdapter {
  exec(sqlText: string): Promise<void> | void
  run(sqlText: string, params?: SqlValue[]): Promise<void>
  get<T>(sqlText: string, params?: SqlValue[]): Promise<T | null>
  all<T>(sqlText: string, params?: SqlValue[]): Promise<T[]>
}
