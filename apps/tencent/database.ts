import type { Database, DatabaseResult, Statement } from './api/database';

export interface PostgresConnection {
  query(sql: string, values: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

export interface PostgresPool extends PostgresConnection {
  connect(): Promise<PostgresConnection & { release(error?: Error): void }>;
}

class PostgresStatement implements Statement {
  constructor(
    readonly connection: PostgresConnection,
    readonly sql: string,
    readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new PostgresStatement(this.connection, this.sql, values);
  }

  async first<T>(column?: string): Promise<T | null> {
    const { results } = await this.all<Record<string, unknown>>();
    const row = results[0];
    return (column === undefined ? row : row?.[column]) as T | undefined ?? null;
  }

  async all<T>(connection = this.connection): Promise<DatabaseResult<T>> {
    const { rows, rowCount } = await connection.query(this.sql, this.values);
    return { results: rows as T[], meta: { changes: rowCount ?? 0 } };
  }

  run<T>() {
    return this.all<T>();
  }
}

export function postgresDatabase(pool: PostgresPool): Database {
  return {
    prepare(sql) {
      // The application uses positional placeholders in its static SQL.
      let index = 0;
      return new PostgresStatement(pool, sql.replaceAll('?', () => '$' + ++index));
    },
    async batch<T>(statements: Statement[]) {
      const connection = await pool.connect();
      let releaseError: Error | undefined;
      try {
        await connection.query('BEGIN', []);
        const results = [];
        for (const statement of statements) {
          if (!(statement instanceof PostgresStatement)) throw new TypeError('Expected a PostgreSQL statement');
          results.push(await statement.all<T>(connection));
        }
        await connection.query('COMMIT', []);
        return results;
      } catch (error) {
        try {
          await connection.query('ROLLBACK', []);
        } catch (rollbackError) {
          releaseError = new Error('PostgreSQL rollback failed', { cause: rollbackError });
        }
        throw error;
      } finally {
        connection.release(releaseError);
      }
    },
  };
}
