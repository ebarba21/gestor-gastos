// Seccion de categorias y subcategorias: arbol de un nivel con CRUD, archivar/restaurar y
// borrado con reglas de integridad (bloqueado si esta en uso o tiene subcategorias; se
// ofrece archivar). Toda la logica vive en categoryService; aqui solo orquestacion de UI.
import { useMemo, useState } from 'react';
import type { Category } from '../../db/schema';
import { useCategories } from '../../hooks/useCategories';
import { categoryService } from '../../services/categoryService';
import { EmptyState, ConfirmDialog, type DialogButton } from '../common';
import { useToast } from '../../context/ToastContext';
import { CategoryFormModal } from './CategoryFormModal';

function KindBadge({ kind }: { kind: Category['kind'] }) {
  const label = kind === 'expense' ? 'Gasto' : kind === 'income' ? 'Ingreso' : 'Ambos';
  return (
    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-slate-400">
      {label}
    </span>
  );
}

function CategoryRow({
  category,
  isSub,
  onEdit,
  onAddSub,
  onArchive,
  onUnarchive,
  onDelete,
}: {
  category: Category;
  isSub: boolean;
  onEdit: () => void;
  onAddSub?: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
}) {
  const archived = category.archivedAt !== null;
  return (
    <div
      className={[
        // flex-wrap: en pantallas estrechas las acciones bajan a una segunda linea en vez de
        // desbordar la pantalla.
        'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2',
        isSub ? 'ml-6' : '',
        archived ? 'opacity-60' : '',
      ].join(' ')}
    >
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm"
        style={{ backgroundColor: category.color ?? '#334155' }}
      >
        {category.icon ?? ''}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-slate-100">{category.name}</span>
      {!isSub && <KindBadge kind={category.kind} />}
      {archived && (
        <span className="rounded bg-amber-900/40 px-1.5 py-0.5 text-[11px] text-amber-300">
          Archivada
        </span>
      )}
      <div className="ml-auto flex shrink-0 gap-1 text-xs">
        {!archived && (
          <>
            <button
              type="button"
              onClick={onEdit}
              className="rounded px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            >
              Editar
            </button>
            {onAddSub && (
              <button
                type="button"
                onClick={onAddSub}
                className="rounded px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              >
                + Sub
              </button>
            )}
            <button
              type="button"
              onClick={onArchive}
              className="rounded px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            >
              Archivar
            </button>
          </>
        )}
        {archived && (
          <button
            type="button"
            onClick={onUnarchive}
            className="rounded px-2 py-1 text-emerald-400 hover:bg-slate-800"
          >
            Restaurar
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          className="rounded px-2 py-1 text-red-400 hover:bg-red-950/60"
        >
          Eliminar
        </button>
      </div>
    </div>
  );
}

export function CategoriesSection() {
  const { profileId, tree, loading, error, reload } = useCategories();
  const { showToast } = useToast();
  const [showArchived, setShowArchived] = useState(false);

  // Estado de formularios y dialogos.
  const [createRootOpen, setCreateRootOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [addingSubTo, setAddingSubTo] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);

  const archivedCount = useMemo(
    () =>
      tree.reduce(
        (acc, n) =>
          acc +
          (n.category.archivedAt !== null ? 1 : 0) +
          n.children.filter((c) => c.archivedAt !== null).length,
        0,
      ),
    [tree],
  );

  const visibleTree = useMemo(
    () =>
      tree
        .filter((n) => showArchived || n.category.archivedAt === null)
        .map((n) => ({
          category: n.category,
          children: n.children.filter((c) => showArchived || c.archivedAt === null),
        })),
    [tree, showArchived],
  );

  async function archive(cat: Category) {
    await categoryService.archiveCategory(profileId, cat.id);
    showToast('Categoria archivada.', 'info');
    await reload();
  }
  async function unarchive(cat: Category) {
    await categoryService.unarchiveCategory(profileId, cat.id);
    showToast('Categoria restaurada.', 'success');
    await reload();
  }

  const deleteButtons: DialogButton[] = deleting
    ? [
        { label: 'Cancelar', variant: 'ghost' },
        ...(deleting.archivedAt === null
          ? [
              {
                label: 'Archivar',
                variant: 'primary' as const,
                onClick: async () => {
                  await categoryService.archiveCategory(profileId, deleting.id);
                  showToast('Categoria archivada.', 'info');
                  await reload();
                },
              },
            ]
          : []),
        {
          label: 'Eliminar',
          variant: 'danger' as const,
          onClick: async () => {
            await categoryService.deleteCategory(profileId, deleting.id);
            showToast('Categoria eliminada.', 'success');
            await reload();
          },
        },
      ]
    : [];

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-100">Categorias</h3>
        <button
          type="button"
          onClick={() => setCreateRootOpen(true)}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Nueva categoria
        </button>
      </div>

      {archivedCount > 0 && (
        <label className="mb-3 flex items-center gap-2 text-sm text-slate-400">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Mostrar archivadas ({archivedCount})
        </label>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading ? (
        <p className="text-sm text-slate-500">Cargando...</p>
      ) : visibleTree.length === 0 ? (
        <EmptyState
          icon="🗂️"
          title="Sin categorias"
          description="Crea tu primera categoria para clasificar tus movimientos."
        />
      ) : (
        <div className="space-y-3">
          {visibleTree.map((node) => (
            <div key={node.category.id} className="space-y-1.5">
              <CategoryRow
                category={node.category}
                isSub={false}
                onEdit={() => setEditing(node.category)}
                onAddSub={() => setAddingSubTo(node.category)}
                onArchive={() => void archive(node.category)}
                onUnarchive={() => void unarchive(node.category)}
                onDelete={() => setDeleting(node.category)}
              />
              {node.children.map((child) => (
                <CategoryRow
                  key={child.id}
                  category={child}
                  isSub
                  onEdit={() => setEditing(child)}
                  onArchive={() => void archive(child)}
                  onUnarchive={() => void unarchive(child)}
                  onDelete={() => setDeleting(child)}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      <CategoryFormModal
        open={createRootOpen}
        onClose={() => setCreateRootOpen(false)}
        profileId={profileId}
        onSaved={reload}
      />
      <CategoryFormModal
        open={editing !== null}
        onClose={() => setEditing(null)}
        profileId={profileId}
        onSaved={reload}
        category={editing}
      />
      <CategoryFormModal
        open={addingSubTo !== null}
        onClose={() => setAddingSubTo(null)}
        profileId={profileId}
        onSaved={reload}
        parent={addingSubTo}
      />
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Eliminar categoria"
        message={
          deleting ? (
            <span>
              Vas a eliminar <strong className="text-slate-100">{deleting.name}</strong>. Si tiene
              subcategorias o esta en uso por movimientos, no se podra eliminar: archivala para
              conservar el historico.
            </span>
          ) : null
        }
        buttons={deleteButtons}
      />
    </section>
  );
}
