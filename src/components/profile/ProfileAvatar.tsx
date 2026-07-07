// Avatar de perfil: circulo con el color de acento y, si existe, el emoji; si no, la
// inicial del nombre. Solo presentacion.
import type { Profile } from '../../db/schema';

interface ProfileAvatarProps {
  profile: Profile;
  size?: 'sm' | 'md' | 'lg';
}

const SIZES: Record<NonNullable<ProfileAvatarProps['size']>, string> = {
  sm: 'h-8 w-8 text-sm',
  md: 'h-10 w-10 text-base',
  lg: 'h-16 w-16 text-2xl',
};

export function ProfileAvatar({ profile, size = 'md' }: ProfileAvatarProps) {
  const initial = profile.name.trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${SIZES[size]}`}
      style={{ backgroundColor: profile.color }}
      aria-hidden
    >
      {profile.avatarEmoji ?? initial}
    </span>
  );
}
