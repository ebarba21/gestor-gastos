// Hook de comercios del perfil activo. Carga comercios activos y archivados, y las entidades
// auxiliares que la UI necesita (categorias/subcategorias y etiquetas para los defaults).
// Expone recarga. Los handlers de accion llaman a merchantService y despues a reload().
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useActiveProfileId } from './useProfiles';
import { merchantService } from '../services/merchantService';
import { categoryService } from '../services/categoryService';
import { tagService } from '../services/tagService';
import type { Category, Merchant, Tag } from '../db/schema';

export interface UseMerchants {
  profileId: string;
  merchants: Merchant[];
  archivedMerchants: Merchant[];
  categories: Category[];
  tags: Tag[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  categoryNames: Map<string, string>;
  tagNames: Map<string, string>;
  merchantNames: Map<string, string>;
}

export function useMerchants(): UseMerchants {
  const profileId = useActiveProfileId();
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [archivedMerchants, setArchivedMerchants] = useState<Merchant[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [active, archived, cats, tgs] = await Promise.all([
        merchantService.list(profileId),
        merchantService.listArchived(profileId),
        categoryService.listAll(profileId),
        tagService.listTags(profileId),
      ]);
      setMerchants(active);
      setArchivedMerchants(archived);
      setCategories(cats);
      setTags(tgs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar los comercios.');
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const categoryNames = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  );
  const tagNames = useMemo(() => new Map(tags.map((t) => [t.id, t.name])), [tags]);
  const merchantNames = useMemo(
    () => new Map([...merchants, ...archivedMerchants].map((m) => [m.id, m.canonicalName])),
    [merchants, archivedMerchants],
  );

  return {
    profileId,
    merchants,
    archivedMerchants,
    categories,
    tags,
    loading,
    error,
    reload,
    categoryNames,
    tagNames,
    merchantNames,
  };
}
