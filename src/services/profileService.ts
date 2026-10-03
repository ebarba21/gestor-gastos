// Logica de negocio de perfiles locales (ver specs/ARCHITECTURE.md seccion 2 y
// DATA_MODEL.md 2.1). Orquesta profilesRepo y settingsRepo; no conoce React.
//
// El "perfil activo" NO se persiste en la base de datos: vive en localStorage como
// un unico id (dato no financiero) para reabrir el mismo perfil al arrancar
// (DATA_MODEL 2.1 y ARCHITECTURE seccion 6).
import type { Profile } from '../db/schema';
import { profilesRepo } from '../db/profilesRepo';
import { settingsRepo, defaultSettingInput } from '../db/settingsRepo';
import { seedDefaultCategories } from './categoryService';
import { ValidationError } from '../lib/validation';

// Clave de localStorage. No sensible: solo guarda que perfil abrir al arrancar.
export const ACTIVE_PROFILE_KEY = 'gestor-gastos:active-profile';

// Longitud maxima del nombre visible de un perfil.
export const MAX_PROFILE_NAME_LENGTH = 60;

// Paleta de acentos para perfiles. Se elige uno por defecto segun cuantos perfiles
// existan para que los primeros salgan variados; el usuario puede cambiarlo.
export const PROFILE_COLORS: readonly string[] = [
  '#6366f1', // indigo
  '#ec4899', // pink
  '#f59e0b', // amber
  '#10b981', // emerald
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ef4444', // red
  '#14b8a6', // teal
];

// Emojis sugeridos como avatar. Opcional (el modelo admite avatarEmoji = null).
export const PROFILE_EMOJIS: readonly string[] = [
  '🙂',
  '💼',
  '🏠',
  '👨‍👩‍👧',
  '✈️',
  '🎓',
  '🐱',
  '🌱',
];

export function pickDefaultColor(existingCount: number): string {
  const len = PROFILE_COLORS.length;
  const index = ((existingCount % len) + len) % len;
  return PROFILE_COLORS[index] ?? PROFILE_COLORS[0]!;
}

// Normaliza y valida el nombre de un perfil. Sin errores silenciosos.
export function normalizeProfileName(name: string): string {
  const trimmed = (name ?? '').trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) {
    throw new ValidationError('El nombre del perfil no puede estar vacio.');
  }
  if (trimmed.length > MAX_PROFILE_NAME_LENGTH) {
    throw new ValidationError(
      `El nombre del perfil no puede superar ${MAX_PROFILE_NAME_LENGTH} caracteres.`,
    );
  }
  return trimmed;
}

export interface CreateProfileInput {
  name: string;
  color?: string;
  avatarEmoji?: string | null;
}

export interface UpdateProfileInput {
  name?: string;
  color?: string;
  avatarEmoji?: string | null;
}

export const profileService = {
  // Perfiles visibles, ordenados por fecha de creacion (los mas antiguos primero). Se pasa el
  // `ownerUserId` de la sesion (o null sin sesion): nunca se listan perfiles de otra cuenta ni,
  // sin sesion, perfiles vinculados a una cuenta (invariante 4; ver profilesRepo.listVisibleTo).
  async listProfiles(ownerUserId: string | null = null): Promise<Profile[]> {
    const profiles = await profilesRepo.listVisibleTo(ownerUserId);
    return profiles.sort((a, b) => a.createdAt - b.createdAt);
  },

  getProfile(id: string): Promise<Profile | undefined> {
    return profilesRepo.getById(id);
  },

  // Crea el perfil y su Setting por defecto. Operacion atomica de facto: si la creacion
  // de la configuracion falla, se revierte el perfil para no dejar un perfil sin ajustes.
  async createProfile(input: CreateProfileInput): Promise<Profile> {
    const name = normalizeProfileName(input.name);
    const existing = await profilesRepo.listActive();
    const color = input.color ?? pickDefaultColor(existing.length);
    const avatarEmoji = input.avatarEmoji ?? null;

    const profile = await profilesRepo.create({ name, color, avatarEmoji });
    try {
      await settingsRepo.create(profile.id, defaultSettingInput());
      // Un perfil nuevo arranca con un set de categorias por defecto (editable y borrable).
      await seedDefaultCategories(profile.id);
    } catch (err) {
      // Rollback: borra en cascada lo que se hubiera creado y propaga el error.
      await profilesRepo.removeCascade(profile.id).catch(() => undefined);
      throw err;
    }
    return profile;
  },

  // Edita nombre, color o avatar. Valida el nombre si viene en el patch.
  async updateProfile(id: string, patch: UpdateProfileInput): Promise<Profile> {
    const clean: UpdateProfileInput = { ...patch };
    if (patch.name !== undefined) clean.name = normalizeProfileName(patch.name);
    return profilesRepo.update(id, clean);
  },

  renameProfile(id: string, name: string): Promise<Profile> {
    return profileService.updateProfile(id, { name });
  },

  // Borrado destructivo e irreversible: barre en cascada todas las entidades del perfil.
  // Si el perfil borrado era el activo, limpia la preferencia de perfil activo.
  async deleteProfile(id: string): Promise<void> {
    await profilesRepo.removeCascade(id);
    if (profileService.getActiveProfileId() === id) {
      profileService.clearActiveProfileId();
    }
  },

  // --- Preferencia de perfil activo (localStorage, solo el id) ---

  getActiveProfileId(): string | null {
    try {
      return localStorage.getItem(ACTIVE_PROFILE_KEY);
    } catch {
      // localStorage puede no estar disponible (modo privado estricto). Sin ruido.
      return null;
    }
  },

  setActiveProfileId(id: string): void {
    try {
      localStorage.setItem(ACTIVE_PROFILE_KEY, id);
    } catch {
      // No es critico: la app sigue funcionando en memoria durante la sesion.
    }
  },

  clearActiveProfileId(): void {
    try {
      localStorage.removeItem(ACTIVE_PROFILE_KEY);
    } catch {
      // Ignorado deliberadamente.
    }
  },

  // Resuelve el perfil activo al arrancar: el id guardado solo vale si el perfil sigue existiendo
  // (no archivado) Y pertenece a la sesion activa. Si no, limpia la preferencia obsoleta. Pasar el
  // `ownerUserId` evita reabrir el perfil de otra cuenta que hubiera quedado como "ultimo activo".
  async resolveActiveProfile(ownerUserId: string | null = null): Promise<Profile | null> {
    const storedId = profileService.getActiveProfileId();
    if (!storedId) return null;
    const profiles = await profilesRepo.listVisibleTo(ownerUserId);
    const match = profiles.find((p) => p.id === storedId);
    if (!match) {
      profileService.clearActiveProfileId();
      return null;
    }
    return match;
  },
};
