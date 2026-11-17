export type DatabaseResult<T> = {
  results: T[];
  meta: { changes: number };
};

export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  first<T = unknown>(column: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<DatabaseResult<T>>;
  run<T = Record<string, unknown>>(): Promise<DatabaseResult<T>>;
}

export interface Database {
  prepare(sql: string): Statement;
  batch<T = Record<string, unknown>>(statements: Statement[]): Promise<DatabaseResult<T>[]>;
}

export const unixNow = 'floor(extract(epoch FROM statement_timestamp()))::bigint';
export const businessDay = 'business_date()';
export const utcTimestamp = 'utc_timestamp_text()';
