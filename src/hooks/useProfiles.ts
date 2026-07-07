// Puente React <-> perfiles. Reexporta el contexto de perfil activo para que los
// componentes consuman perfiles sin conocer la implementacion del contexto.
// Ver ARCHITECTURE.md seccion 2 (hooks) y 9 (aislamiento).
export {
  useProfileContext as useProfiles,
  useActiveProfile,
  useActiveProfileId,
} from '../context/ProfileContext';
