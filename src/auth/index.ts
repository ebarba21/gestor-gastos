// Barrel del modulo de autenticacion de cuenta (opcional).
export { AuthProvider, useAuth, useAuthOptional, type AuthStatus } from './AuthContext';
export {
  authService,
  createAuthService,
  type AuthService,
  type SignUpResult,
  type AuthChangeEvent,
} from './authService';
export { AuthError, toAuthError, type AuthErrorCode } from './errors';
