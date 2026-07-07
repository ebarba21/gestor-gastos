// Hook de etiquetas del perfil activo. Carga la lista y expone recarga.
import { useCallback, useEffect, useState } from 'react';
import { useActiveProfileId } from './useProfiles';
import { tagService } from '../services/tagService';
import type { Tag } from '../db/schema';

interface UseTags {
  profileId: string;
  tags: Tag[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useTags(): UseTags {
  const profileId = useActiveProfileId();
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setTags(await tagService.listTags(profileId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las etiquetas.');
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { profileId, tags, loading, error, reload };
}
