// Hook de categorias del perfil activo. Carga el arbol (raices con subcategorias,
// incluidas archivadas para poder mostrarlas separadas) y expone recarga. Los handlers
// de accion de los componentes llaman a categoryService y despues a reload().
import { useCallback, useEffect, useState } from 'react';
import { useActiveProfileId } from './useProfiles';
import { categoryService, type CategoryNode } from '../services/categoryService';

interface UseCategories {
  profileId: string;
  tree: CategoryNode[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useCategories(): UseCategories {
  const profileId = useActiveProfileId();
  const [tree, setTree] = useState<CategoryNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const t = await categoryService.listTree(profileId, { includeArchived: true });
      setTree(t);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las categorias.');
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { profileId, tree, loading, error, reload };
}
