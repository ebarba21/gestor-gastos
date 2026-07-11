import { describe, it, expect } from 'vitest';
import type { AppSupabaseClient } from '../lib/supabase/client';
import { buildInsertRow, stripOwnershipKeys, createRemoteRepo } from './remoteRepo';

const USER_A = 'user-a';
const USER_B = 'user-b';
const PROFILE = 'profile-1';

describe('stripOwnershipKeys (patch no puede tocar propiedad ni revision)', () => {
  it('elimina id, owner_user_id, profile_id y revision del patch', () => {
    const clean = stripOwnershipKeys({
      name: 'Nuevo',
      id: 'x',
      owner_user_id: USER_B,
      profile_id: 'otro',
      revision: 99,
    });
    expect(clean).toEqual({ name: 'Nuevo' });
  });

  it('no muta el patch original', () => {
    const original = { name: 'A', owner_user_id: USER_B };
    stripOwnershipKeys(original);
    expect(original.owner_user_id).toBe(USER_B);
  });
});

describe('buildInsertRow (fija propietario y perfil desde la sesion)', () => {
  it('el owner y el profile ganan siempre a lo que venga en values', () => {
    const row = buildInsertRow(
      USER_A,
      PROFILE,
      {
        owner_user_id: USER_B,
        profile_id: 'perfil-ajeno',
        name: 'Banco',
        kind: 'bank',
        currency: 'EUR',
      } as never,
    ) as Record<string, unknown>;
    expect(row.owner_user_id).toBe(USER_A);
    expect(row.profile_id).toBe(PROFILE);
    expect(row.name).toBe('Banco');
  });
});

// --- Fake client que graba filtros y payloads para verificar el scoping owner+profile ---
interface QueryState {
  table: string;
  op: 'select' | 'insert' | 'update';
  filters: Record<string, unknown>;
  payload?: unknown;
}

function makeFakeClient(dataFor: (s: QueryState) => unknown) {
  const calls: QueryState[] = [];
  function makeQuery(table: string) {
    const state: QueryState = { table, op: 'select', filters: {}, payload: undefined };
    const resolve = () => {
      calls.push(state);
      return Promise.resolve({ data: dataFor(state), error: null });
    };
    const q: Record<string, unknown> = {
      select: () => q,
      insert: (row: unknown) => {
        state.op = 'insert';
        state.payload = row;
        return q;
      },
      update: (patch: unknown) => {
        state.op = 'update';
        state.payload = patch;
        return q;
      },
      eq: (col: string, val: unknown) => {
        state.filters[col] = val;
        return q;
      },
      is: (col: string, val: unknown) => {
        state.filters[col] = val;
        return q;
      },
      single: resolve,
      maybeSingle: resolve,
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        resolve().then(onF, onR),
    };
    return q;
  }
  const client = { from: (table: string) => makeQuery(table) } as unknown as AppSupabaseClient;
  return { client, calls };
}

describe('createRemoteRepo (aislamiento por propietario + perfil en toda operacion)', () => {
  it('list filtra por owner_user_id, profile_id y deleted_at is null', async () => {
    const { client, calls } = makeFakeClient(() => []);
    const repo = createRemoteRepo(client, 'accounts', USER_A);
    await repo.list(PROFILE);
    expect(calls[0].filters.owner_user_id).toBe(USER_A);
    expect(calls[0].filters.profile_id).toBe(PROFILE);
    expect(calls[0].filters.deleted_at).toBeNull();
  });

  it('getById filtra por owner, perfil e id', async () => {
    const { client, calls } = makeFakeClient(() => null);
    const repo = createRemoteRepo(client, 'accounts', USER_A);
    await repo.getById(PROFILE, 'acc-1');
    expect(calls[0].filters).toMatchObject({
      owner_user_id: USER_A,
      profile_id: PROFILE,
      id: 'acc-1',
    });
  });

  it('insert manda owner_user_id de la sesion, ignorando el del payload', async () => {
    const { client, calls } = makeFakeClient((s) => s.payload);
    const repo = createRemoteRepo(client, 'accounts', USER_A);
    await repo.insert(PROFILE, {
      owner_user_id: USER_B,
      profile_id: 'ajeno',
      name: 'Banco',
      kind: 'bank',
      currency: 'EUR',
    } as never);
    const payload = calls[0].payload as Record<string, unknown>;
    expect(payload.owner_user_id).toBe(USER_A);
    expect(payload.profile_id).toBe(PROFILE);
  });

  it('update no permite cambiar owner_user_id ni profile_id (se eliminan del patch)', async () => {
    const { client, calls } = makeFakeClient((s) => s.payload);
    const repo = createRemoteRepo(client, 'accounts', USER_A);
    await repo.update(PROFILE, 'acc-1', {
      name: 'Renombrada',
      owner_user_id: USER_B,
      profile_id: 'ajeno',
    } as never);
    const payload = calls[0].payload as Record<string, unknown>;
    expect(payload.name).toBe('Renombrada');
    expect(payload.owner_user_id).toBeUndefined();
    expect(payload.profile_id).toBeUndefined();
    // Y la propia query queda acotada al owner de la sesion.
    expect(calls[0].filters.owner_user_id).toBe(USER_A);
  });

  it('softDelete marca deleted_at en vez de borrar fisicamente', async () => {
    const { client, calls } = makeFakeClient(() => null);
    const repo = createRemoteRepo(client, 'accounts', USER_A);
    await repo.softDelete(PROFILE, 'acc-1');
    const payload = calls[0].payload as Record<string, unknown>;
    expect(payload.deleted_at).toBeTruthy();
    expect(calls[0].filters).toMatchObject({ owner_user_id: USER_A, profile_id: PROFILE, id: 'acc-1' });
  });
});
