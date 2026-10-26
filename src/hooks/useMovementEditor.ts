// Abre la ficha de un movimiento a partir de su id (p. ej. desde el dashboard, que solo
// maneja ids y agregados). Carga el movimiento y las etiquetas del perfil activo a traves de
// los services (que exigen profileId: aislamiento por diseno) y expone el estado que necesita
// TransactionFormModal. Si el movimiento ya no existe (borrado en otro dispositivo, otro
// perfil), lo comunica como error explicito en lugar de abrir una ficha vacia.
import { useCallback, useEffect, useState } from 'react';
import type { Tag, Transaction } from '../db/schema';
import { useActiveProfileId } from './useProfiles';
import { transactionService } from '../services/transactionService';
import { tagService } from '../services/tagService';

export interface UseMovementEditor {
  editing: Transaction | null;
  tags: Tag[];
  opening: boolean;
  open: (id: string) => Promise<boolean>;
  close: () => void;
}

export function useMovementEditor(onError: (message: string) => void): UseMovementEditor {
  const profileId = useActiveProfileId();
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [opening, setOpening] = useState(false);

  // Nunca se arrastra una ficha abierta al cambiar de perfil.
  useEffect(() => {
    setEditing(null);
  }, [profileId]);

  const open = useCallback(
    async (id: string): Promise<boolean> => {
      setOpening(true);
      try {
        const [tx, tgs] = await Promise.all([
          transactionService.getById(profileId, id),
          tagService.listTags(profileId),
        ]);
        if (!tx) {
          onError('Ese movimiento ya no existe.');
          return false;
        }
        setTags(tgs);
        setEditing(tx);
        return true;
      } catch (e) {
        onError(e instanceof Error ? e.message : 'No se pudo abrir el movimiento.');
        return false;
      } finally {
        setOpening(false);
      }
    },
    [profileId, onError],
  );

  const close = useCallback(() => setEditing(null), []);

  return { editing, tags, opening, open, close };
}
