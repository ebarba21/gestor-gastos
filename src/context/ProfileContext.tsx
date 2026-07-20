// Contexto del perfil activo: UNICA fuente del profileId en uso en toda la app
// (invariante 4 de CLAUDE.md, ARCHITECTURE.md seccion 9). Toda operacion de datos
// obtiene su profileId de aqui, nunca de otra parte. No existe ninguna vista que
// combine perfiles.
//
// El guard de perfil (ProfileGate) garantiza que, cuando se renderiza la app, siempre
// hay un perfil activo: por eso useActiveProfile() puede exigirlo.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Profile } from '../db/schema';
import {
  profileService,
  type CreateProfileInput,
  type UpdateProfileInput,
} from '../services/profileService';
import { useAuthOptional } from '../auth';

type Status = 'loading' | 'ready';

interface ProfileContextValue {
  status: Status;
  profiles: Profile[];
  activeProfileId: string | null;
  activeProfile: Profile | null;
  // Acciones. Todas recargan la lista y devuelven el resultado para poder encadenar UI.
  createProfile: (input: CreateProfileInput) => Promise<Profile>;
  updateProfile: (id: string, patch: UpdateProfileInput) => Promise<Profile>;
  deleteProfile: (id: string) => Promise<void>;
  switchProfile: (id: string) => void;
  // Sale al selector de perfil sin borrar nada (para "cambiar de perfil").
  goToProfileSelection: () => void;
  reload: () => Promise<void>;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);

  // Propietario de la sesion activa (null en modo local puro o si no hay AuthProvider). Acota la
  // lista de perfiles a los de esta cuenta (invariante 4): en un navegador compartido por varias
  // cuentas, una cuenta nunca ve los perfiles de otra. Al cambiar de cuenta se recargan y, si el
  // perfil activo era de otra cuenta, se cae al selector.
  const auth = useAuthOptional();
  const ownerUserId = auth?.user?.id ?? null;

  // Carga inicial y recarga al cambiar de propietario: perfiles + resolucion del perfil activo
  // guardado en localStorage (solo valido si pertenece a la sesion activa).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [list, active] = await Promise.all([
        profileService.listProfiles(ownerUserId),
        profileService.resolveActiveProfile(ownerUserId),
      ]);
      if (cancelled) return;
      setProfiles(list);
      setActiveProfileId(active ? active.id : null);
      setStatus('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, [ownerUserId]);

  const reload = useCallback(async () => {
    const list = await profileService.listProfiles(ownerUserId);
    setProfiles(list);
    // Si el perfil activo dejo de existir (o no pertenece a la sesion), se cae al selector y se
    // limpia la preferencia obsoleta en localStorage (no se arrastra hasta el proximo arranque).
    setActiveProfileId((current) => {
      if (current && list.some((p) => p.id === current)) return current;
      profileService.clearActiveProfileId();
      return null;
    });
  }, [ownerUserId]);

  const switchProfile = useCallback((id: string) => {
    profileService.setActiveProfileId(id);
    setActiveProfileId(id);
  }, []);

  const goToProfileSelection = useCallback(() => {
    profileService.clearActiveProfileId();
    setActiveProfileId(null);
  }, []);

  const createProfile = useCallback(
    async (input: CreateProfileInput) => {
      const profile = await profileService.createProfile(input);
      await reload();
      // Un perfil recien creado pasa a ser el activo.
      profileService.setActiveProfileId(profile.id);
      setActiveProfileId(profile.id);
      return profile;
    },
    [reload],
  );

  const updateProfile = useCallback(
    async (id: string, patch: UpdateProfileInput) => {
      const profile = await profileService.updateProfile(id, patch);
      await reload();
      return profile;
    },
    [reload],
  );

  const deleteProfile = useCallback(
    async (id: string) => {
      await profileService.deleteProfile(id);
      await reload();
    },
    [reload],
  );

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) ?? null,
    [profiles, activeProfileId],
  );

  const value = useMemo<ProfileContextValue>(
    () => ({
      status,
      profiles,
      activeProfileId,
      activeProfile,
      createProfile,
      updateProfile,
      deleteProfile,
      switchProfile,
      goToProfileSelection,
      reload,
    }),
    [
      status,
      profiles,
      activeProfileId,
      activeProfile,
      createProfile,
      updateProfile,
      deleteProfile,
      switchProfile,
      goToProfileSelection,
      reload,
    ],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfileContext(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) {
    throw new Error('useProfileContext debe usarse dentro de <ProfileProvider>.');
  }
  return ctx;
}

// Devuelve el perfil activo garantizado. Uso exclusivo dentro de la app ya "abierta"
// (bajo ProfileGate): si no hay perfil activo es un error de programacion, no un estado
// normal. Los componentes de datos usan esto para obtener el profileId.
export function useActiveProfile(): Profile {
  const { activeProfile } = useProfileContext();
  if (!activeProfile) {
    throw new Error(
      'No hay perfil activo. useActiveProfile solo puede usarse dentro de ProfileGate.',
    );
  }
  return activeProfile;
}

// Atajo cuando solo se necesita el id para pasarlo a un repositorio/servicio.
export function useActiveProfileId(): string {
  return useActiveProfile().id;
}
