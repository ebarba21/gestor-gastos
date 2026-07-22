// Seccion de etiquetas: CRUD. Al borrar una etiqueta en uso se desvincula de los
// movimientos que la llevan (la confirmacion muestra a cuantos afecta).
import { useState } from 'react';
import type { Tag } from '../../db/schema';
import { useTags } from '../../hooks/useTags';
import { tagService } from '../../services/tagService';
import { EmptyState, ConfirmDialog } from '../common';
import { useToast } from '../../context/ToastContext';
import { TagFormModal } from './TagFormModal';

export function TagsSection() {
  const { profileId, tags, loading, error, reload } = useTags();
  const { showToast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Tag | null>(null);
  const [deleting, setDeleting] = useState<Tag | null>(null);
  const [usage, setUsage] = useState<number | null>(null);

  async function requestDelete(tag: Tag) {
    setDeleting(tag);
    setUsage(null);
    // Cargamos el numero de movimientos afectados para el mensaje de confirmacion.
    setUsage(await tagService.countUsage(profileId, tag.id));
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-100">Etiquetas</h3>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Nueva etiqueta
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading ? (
        <p className="text-sm text-slate-500">Cargando...</p>
      ) : tags.length === 0 ? (
        <EmptyState
          icon="🏷️"
          title="Sin etiquetas"
          description="Las etiquetas permiten clasificar movimientos de forma transversal a las categorías."
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <div
              key={tag.id}
              className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900 py-1 pl-2 pr-1 text-sm"
            >
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: tag.color ?? '#334155' }}
                aria-hidden
              />
              <span className="text-slate-100">{tag.name}</span>
              <button
                type="button"
                onClick={() => setEditing(tag)}
                className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={() => void requestDelete(tag)}
                className="rounded px-1.5 py-0.5 text-xs text-red-400 hover:bg-red-950/60"
              >
                Eliminar
              </button>
            </div>
          ))}
        </div>
      )}

      <TagFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        profileId={profileId}
        onSaved={reload}
      />
      <TagFormModal
        open={editing !== null}
        onClose={() => setEditing(null)}
        profileId={profileId}
        onSaved={reload}
        tag={editing}
      />
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Eliminar etiqueta"
        message={
          deleting ? (
            <span>
              Vas a eliminar la etiqueta <strong className="text-slate-100">{deleting.name}</strong>
              {usage === null
                ? '...'
                : usage === 0
                  ? '. No esta asignada a ningun movimiento.'
                  : `. Se quitara de ${usage} movimiento${usage === 1 ? '' : 's'} (no se borran los movimientos).`}
            </span>
          ) : null
        }
        buttons={[
          { label: 'Cancelar', variant: 'ghost' },
          {
            label: 'Eliminar',
            variant: 'danger',
            onClick: async () => {
              if (!deleting) return;
              const detached = await tagService.deleteTag(profileId, deleting.id);
              showToast(
                detached > 0
                  ? `Etiqueta eliminada y quitada de ${detached} movimiento${detached === 1 ? '' : 's'}.`
                  : 'Etiqueta eliminada.',
                'success',
              );
              await reload();
            },
          },
        ]}
      />
    </section>
  );
}
