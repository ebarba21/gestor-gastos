import { describe, expect, it, beforeEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { ProfileProvider, useProfileContext } from './ProfileContext';
import { ACTIVE_PROFILE_KEY } from '../services/profileService';
import { db } from '../db';

let ctx: ReturnType<typeof useProfileContext> | null = null;
function Probe() {
  ctx = useProfileContext();
  return null;
}

describe('ProfileProvider: perfil activo recordado entre arranques', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Promise.all(db.tables.map((t) => t.clear()));
    ctx = null;
  });

  it('un perfil recien creado queda guardado como activo en localStorage', async () => {
    render(
      <ProfileProvider>
        <Probe />
      </ProfileProvider>,
    );
    await waitFor(() => expect(ctx?.status).toBe('ready'));
    let id = '';
    await act(async () => {
      const p = await ctx!.createProfile({ name: 'Eric' });
      id = p.id;
    });
    expect(ctx!.activeProfileId).toBe(id);
    expect(localStorage.getItem(ACTIVE_PROFILE_KEY)).toBe(id);
  });

  it('al borrar el perfil activo se limpia la preferencia', async () => {
    render(
      <ProfileProvider>
        <Probe />
      </ProfileProvider>,
    );
    await waitFor(() => expect(ctx?.status).toBe('ready'));
    let id = '';
    await act(async () => {
      id = (await ctx!.createProfile({ name: 'Eric' })).id;
    });
    await act(async () => {
      await ctx!.deleteProfile(id);
    });
    expect(ctx!.activeProfileId).toBeNull();
    expect(localStorage.getItem(ACTIVE_PROFILE_KEY)).toBeNull();
  });
});
