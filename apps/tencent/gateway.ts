import type { Database, DatabaseResult, Statement } from './api/database';

type Command = { sql: string; values: unknown[] };
type Execute = <T>(commands: Command[]) => Promise<DatabaseResult<T>[]>;

class GatewayStatement implements Statement {
  constructor(readonly execute: Execute, readonly command: Command) {}

  bind(...values: unknown[]) {
    const encoded = values.map(value => value instanceof Uint8Array ? '\\x'+Buffer.from(value).toString('hex') : value);
    return new GatewayStatement(this.execute, {...this.command,values:encoded});
  }

  async first<T>(column?: string): Promise<T | null> {
    const { results } = await this.all<Record<string, unknown>>();
    const row = results[0];
    return ((column === undefined ? row : row?.[column]) as T | undefined) ?? null;
  }

  async all<T>() {
    const [result] = await this.execute<T>([this.command]);
    return result;
  }

  run<T>() {
    return this.all<T>();
  }
}

export function cloudbaseDatabase(envId: string, key: string, send = fetch): Database {
  if (!/^[a-z0-9-]+$/.test(envId) || !key) throw new Error('CloudBase environment ID and API key are required');
  const url = 'https://'+envId+'.api.tcloudbasegateway.com/v1/rdb/rest/rpc/reading_record_batch';
  const execute: Execute = async commands => {
    const response = await send(url,{
      method:'POST',
      headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
      body:JSON.stringify({commands}),
      signal:AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as {message?: string; error?: {message?: string}} | null;
      // Only PostgreSQL errors explicitly handled by the app are propagated.
      const message = String(body?.message ?? body?.error?.message ?? '');
      const known = ['password_credentials.nickname_key','active_friendship_members.user_id','date_conflict','page_range']
        .find(value => message.includes(value));
      throw new Error(known ?? 'CloudBase database request failed');
    }
    const results = await response.json();
    if (!Array.isArray(results) || results.length !== commands.length) throw new Error('Invalid CloudBase database result');
    return results;
  };
  return {
    prepare(sql) {
      return new GatewayStatement(execute,{sql:sql.trimStart().replaceAll('?','__rr_bind__'),values:[]});
    },
    batch<T>(statements: Statement[]) {
      const commands = statements.map(statement=>{
        if (!(statement instanceof GatewayStatement)) throw new TypeError('Expected a CloudBase database statement');
        return statement.command;
      });
      return execute<T>(commands);
    },
  };
}
