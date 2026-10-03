import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { db } from '../db';
import { profilesRepo } from '../db/profilesRepo';
import { profileService } from '../services/profileService';

// Estado de cuenta simulado (lo que expondria AuthProvider).
const authState: { status: string; user: { id: string } | null } = { status: 'loading', user: null };
vi.mock('../auth', () => ({ useAuthOptional: () => authState }));

const { ProfileProvider, useProfileContext } = await import('./ProfileContext');

let ctx: ReturnType<typeof useProfileContext> | null = null;
function Probe() {
  ctx = useProfileContext();
  return null;
}

describe('ProfileProvider en un dispositivo compartido', () => {
  beforeEach(async () => {
    localStorage.clear();
    await Promise.all(db.tables.map((t) => t.clear()));
    ctx = null;
  });

  it('sin sesion oculta los perfiles vinculados a una cuenta; con su sesion los muestra', async () => {
    const mine = await profilesRepo.create({ name: 'Eric', color: '#111', avatarEmoji: null, ownerUserId: 'eric' });
    await profilesRepo.create({ name: 'Local', color: '#333', avatarEmoji: null });
    profileService.setActiveProfileId(mine.id);

    authState.status = 'signed-out';
    authState.user = null;
    const { unmount } = render(
      <ProfileProvider>
        <Probe />
      </ProfileProvider>,
    );
    await waitFor(() => expect(ctx?.status).toBe('ready'));
    expect(ctx!.profiles.map((p) => p.name)).toEqual(['Local']);
    expect(ctx!.activeProfileId).toBeNull();
    unmount();

    authState.status = 'signed-in';
    authState.user = { id: 'eric' };
    render(
      <ProfileProvider>
        <Probe />
      </ProfileProvider>,
    );
    await waitFor(() => expect(ctx?.status).toBe('ready'));
    expect(ctx!.profiles.map((p) => p.name).sort()).toEqual(['Eric', 'Local']);
  });

  it('mientras la sesion se restaura no resuelve perfiles ni borra el perfil activo guardado', async () => {
    const mine = await profilesRepo.create({ name: 'Eric', color: '#111', avatarEmoji: null, ownerUserId: 'eric' });
    profileService.setActiveProfileId(mine.id);
    authState.status = 'loading';
    authState.user = null;
    render(
      <ProfileProvider>
        <Probe />
      </ProfileProvider>,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(ctx!.status).toBe('loading');
    expect(profileService.getActiveProfileId()).toBe(mine.id);
  });
});
