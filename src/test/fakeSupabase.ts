// Doble de prueba de Supabase/PostgREST en memoria para los tests de sincronizacion (fase 2).
// Emula lo que necesita src/remote/remoteRepo:
//   - from(table).select/insert/upsert/update + eq/is/gte/order/limit + single/maybeSingle + count;
//   - control de `revision` en el servidor (0 al insertar; +1 en cada update);
//   - `updated_at` autoritativo y creciente (para el cursor de PULL);
//   - upsert por PK con ignoreDuplicates (idempotencia del insert);
//   - update GUARDADO por los filtros eq (incluida revision): 0 filas si no casan.
// No es Postgres real: la RLS se ejerce en tests via los filtros owner/profile que ya pone el repo.
import type { AppSupabaseClient } from '../lib/supabase/client';

type Row = Record<string, unknown>;
type Filter = { op: 'eq' | 'is' | 'gte'; col: string; val: unknown };

export class FakeRemote {
  private tables = new Map<string, Map<string, Row>>();
  // Reloj del servidor: ISO creciente para updated_at (garantiza orden estable en el PULL).
  private tick = 1_700_000_000_000;
  // Fallos de insert forzados por tabla (para simular una FK cuyo padre aun no se ha subido:
  // el primer intento devuelve 23503 y el reintento posterior ya casa). Ver failInserts.
  private forcedInsertFailures = new Map<string, number>();

  private table(name: string): Map<string, Row> {
    let t = this.tables.get(name);
    if (!t) {
      t = new Map();
      this.tables.set(name, t);
    }
    return t;
  }

  private now(): string {
    this.tick += 1;
    return new Date(this.tick).toISOString();
  }

  // Utilidades de inspeccion para los tests.
  count(name: string, predicate?: (row: Row) => boolean): number {
    const rows = [...this.table(name).values()].filter((r) => r.deleted_at == null);
    return predicate ? rows.filter(predicate).length : rows.length;
  }

  get(name: string, id: string): Row | undefined {
    return this.table(name).get(id);
  }

  all(name: string): Row[] {
    return [...this.table(name).values()];
  }

  // Fuerza que los proximos `times` inserts/upserts de una tabla fallen con 23503 (foreign_key),
  // como si el padre referenciado aun no existiera en remoto. El reintento posterior (cuando el
  // padre ya se ha subido) casa normalmente. Sirve para reproducir la FK diferida de la migracion.
  failInserts(name: string, times: number): void {
    this.forcedInsertFailures.set(name, times);
  }

  // Consume un fallo forzado de insert para la tabla, si queda alguno. Devuelve el error a emitir
  // (formato PostgREST) o null si no hay fallo pendiente.
  _consumeForcedInsertFailure(name: string): Row | null {
    const remaining = this.forcedInsertFailures.get(name) ?? 0;
    if (remaining <= 0) return null;
    this.forcedInsertFailures.set(name, remaining - 1);
    return { code: '23503', message: 'insert or update violates foreign key constraint' };
  }

  // Simula la escritura de OTRO dispositivo: bump de revision + updated_at + last_mutation_id.
  simulateRemoteEdit(name: string, id: string, patch: Row): void {
    const row = this.table(name).get(id);
    if (!row) return;
    this.table(name).set(id, {
      ...row,
      ...patch,
      revision: Number(row.revision ?? 0) + 1,
      updated_at: this.now(),
    });
  }

  asClient(): AppSupabaseClient {
    return { from: (name: string) => new FakeQuery(this, name) } as unknown as AppSupabaseClient;
  }

  // --- API interna usada por FakeQuery ---
  _matches(row: Row, filters: Filter[]): boolean {
    return filters.every((f) => {
      if (f.op === 'is') return (row[f.col] ?? null) === f.val;
      if (f.op === 'gte') return String(row[f.col]) >= String(f.val);
      return row[f.col] === f.val;
    });
  }

  _select(name: string, filters: Filter[], order?: { col: string; asc: boolean }, limit?: number): Row[] {
    let rows = [...this.table(name).values()].filter((r) => this._matches(r, filters));
    if (order) {
      rows = rows.slice().sort((a, b) => {
        const av = String(a[order.col]);
        const bv = String(b[order.col]);
        return order.asc ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    if (limit != null) rows = rows.slice(0, limit);
    return rows.map((r) => ({ ...r }));
  }

  _insertOrUpsert(name: string, row: Row, ignoreDuplicates: boolean): Row[] {
    const id = row.id as string;
    const table = this.table(name);
    if (table.has(id)) {
      if (ignoreDuplicates) return []; // idempotencia: no duplica ni pisa.
      const merged = { ...table.get(id), ...row };
      table.set(id, merged);
      return [{ ...merged }];
    }
    // El servidor controla la revision: una fila nueva arranca en 0.
    const stored: Row = { ...row, revision: 0, updated_at: row.updated_at ?? this.now() };
    table.set(id, stored);
    return [{ ...stored }];
  }

  _update(name: string, patch: Row, filters: Filter[]): Row[] {
    const table = this.table(name);
    const affected: Row[] = [];
    for (const [id, row] of table) {
      if (!this._matches(row, filters)) continue;
      const updated: Row = {
        ...row,
        ...patch,
        revision: Number(row.revision ?? 0) + 1, // el servidor incrementa la revision.
        updated_at: this.now(),
      };
      table.set(id, updated);
      affected.push({ ...updated });
    }
    return affected;
  }
}

type Mode = 'select' | 'insert' | 'upsert' | 'update';

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown; count?: number | null }> {
  private filters: Filter[] = [];
  private mode: Mode = 'select';
  private payload: Row = {};
  private ignoreDuplicates = false;
  private orderSpec?: { col: string; asc: boolean };
  private limitN?: number;
  private countMode = false;
  private headMode = false;
  private singleMode: 'single' | 'maybe' | null = null;
  private remote: FakeRemote;
  private name: string;

  constructor(remote: FakeRemote, name: string) {
    this.remote = remote;
    this.name = name;
  }

  select(_columns?: string, options?: { count?: 'exact'; head?: boolean }): FakeQuery {
    if (this.mode !== 'insert' && this.mode !== 'upsert' && this.mode !== 'update') {
      this.mode = 'select';
    }
    if (options?.count) this.countMode = true;
    if (options?.head) this.headMode = true;
    return this;
  }

  insert(row: unknown): FakeQuery {
    this.mode = 'insert';
    this.payload = row as Row;
    return this;
  }

  upsert(row: unknown, options?: { onConflict?: string; ignoreDuplicates?: boolean }): FakeQuery {
    this.mode = 'upsert';
    this.payload = row as Row;
    this.ignoreDuplicates = options?.ignoreDuplicates ?? false;
    return this;
  }

  update(patch: unknown): FakeQuery {
    this.mode = 'update';
    this.payload = patch as Row;
    return this;
  }

  eq(col: string, val: unknown): FakeQuery {
    this.filters.push({ op: 'eq', col, val });
    return this;
  }

  is(col: string, val: unknown): FakeQuery {
    this.filters.push({ op: 'is', col, val });
    return this;
  }

  gte(col: string, val: unknown): FakeQuery {
    this.filters.push({ op: 'gte', col, val });
    return this;
  }

  order(col: string, options?: { ascending?: boolean }): FakeQuery {
    this.orderSpec = { col, asc: options?.ascending ?? true };
    return this;
  }

  limit(n: number): FakeQuery {
    this.limitN = n;
    return this;
  }

  single(): PromiseLike<{ data: unknown; error: unknown }> {
    this.singleMode = 'single';
    return this;
  }

  maybeSingle(): PromiseLike<{ data: unknown; error: unknown }> {
    this.singleMode = 'maybe';
    return this;
  }

  private run(): { data: unknown; error: unknown; count?: number | null } {
    try {
      if (this.mode === 'insert' || this.mode === 'upsert') {
        // Fallo forzado (FK diferida simulada): se emite antes de escribir, como haria Postgres.
        const forced = this.remote._consumeForcedInsertFailure(this.name);
        if (forced) return { data: null, error: forced };
      }
      if (this.mode === 'insert') {
        const rows = this.remote._insertOrUpsert(this.name, this.payload, false);
        return this.shape(rows);
      }
      if (this.mode === 'upsert') {
        const rows = this.remote._insertOrUpsert(this.name, this.payload, this.ignoreDuplicates);
        return this.shape(rows);
      }
      if (this.mode === 'update') {
        const rows = this.remote._update(this.name, this.payload, this.filters);
        return this.shape(rows);
      }
      // select
      if (this.countMode && this.headMode) {
        const rows = this.remote._select(this.name, this.filters);
        return { data: null, error: null, count: rows.length };
      }
      const rows = this.remote._select(this.name, this.filters, this.orderSpec, this.limitN);
      return this.shape(rows);
    } catch (error) {
      return { data: null, error };
    }
  }

  private shape(rows: Row[]): { data: unknown; error: unknown; count?: number | null } {
    if (this.singleMode === 'single') {
      if (rows.length === 0) return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
      return { data: rows[0], error: null };
    }
    if (this.singleMode === 'maybe') {
      return { data: rows[0] ?? null, error: null };
    }
    return { data: rows, error: null };
  }

  then<TResult1 = { data: unknown; error: unknown; count?: number | null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: unknown; count?: number | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}
