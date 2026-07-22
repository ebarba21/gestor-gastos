// Seccion Comercios: listado con busqueda, alta/edicion, archivar/desarchivar, detalle (alias
// y movimientos asociados, con reasignacion), fusion de comercios y revision de candidatos
// (movimientos sin comercio agrupados por concepto). Toda la logica vive en merchantService;
// aqui solo orquestacion de UI.
import { useMemo, useState } from 'react';
import type { Merchant } from '../../db/schema';
import { useMerchants } from '../../hooks/useMerchants';
import { merchantService } from '../../services/merchantService';
import { EmptyState, ConfirmDialog, type DialogButton } from '../common';
import { useToast } from '../../context/ToastContext';
import { MerchantFormModal } from './MerchantFormModal';
import { MerchantDetailModal } from './MerchantDetailModal';
import { MergeMerchantsModal } from './MergeMerchantsModal';
import { CandidateGroupsModal } from './CandidateGroupsModal';

export function MerchantsSection() {
  const {
    profileId,
    merchants,
    archivedMerchants,
    categories,
    tags,
    loading,
    error,
    reload,
    categoryNames,
  } = useMerchants();
  const { showToast } = useToast();

  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Merchant | null>(null);
  const [viewing, setViewing] = useState<Merchant | null>(null);
  const [merging, setMerging] = useState<Merchant | null>(null);
  const [archivingOrUnarchiving, setArchivingOrUnarchiving] = useState<Merchant | null>(null);
  const [candidatesOpen, setCandidatesOpen] = useState(false);

  const visible = showArchived ? archivedMerchants : merchants;
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length === 0) return visible;
    return visible.filter((m) => m.canonicalName.toLowerCase().includes(q));
  }, [visible, search]);

  async function toggleArchive(m: Merchant) {
    try {
      if (m.archivedAt === null) await merchantService.archive(profileId, m.id);
      else await merchantService.unarchive(profileId, m.id);
      showToast(m.archivedAt === null ? 'Comercio archivado.' : 'Comercio reactivado.', 'success');
      await reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo actualizar el comercio.', 'error');
    } finally {
      setArchivingOrUnarchiving(null);
    }
  }

  const archiveButtons: DialogButton[] = archivingOrUnarchiving
    ? [
        { label: 'Cancelar', variant: 'ghost' },
        {
          label: archivingOrUnarchiving.archivedAt === null ? 'Archivar' : 'Reactivar',
          variant: archivingOrUnarchiving.archivedAt === null ? 'danger' : 'primary',
          onClick: () => toggleArchive(archivingOrUnarchiving),
        },
      ]
    : [];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">Comercios</h2>
          <p className="mt-1 text-sm text-slate-400">
            Agrupa conceptos bancarios distintos ("AMZN Mktp ES", "Amazon.es*1234") bajo un mismo
            comercio, sin perder el texto original.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCandidatesOpen(true)}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-200 hover:bg-slate-800"
          >
            Revisar movimientos sin comercio
          </button>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Nuevo comercio
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar comercio..."
          className="min-w-[12rem] flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500"
        />
        <label className="flex items-center gap-1.5 text-sm text-slate-400">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Ver archivados
        </label>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <p className="text-sm text-slate-500">Cargando comercios...</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="🏬"
          title={showArchived ? 'Sin comercios archivados' : 'Sin comercios'}
          description={
            showArchived
              ? 'Los comercios que archives apareceran aquí.'
              : 'Crea un comercio o revisa los candidatos detectados a partir de tus movimientos.'
          }
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((m) => (
            <div
              key={m.id}
              className={[
                'flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2.5',
                m.archivedAt !== null ? 'opacity-60' : '',
              ].join(' ')}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-100">{m.canonicalName}</p>
                {m.defaultCategoryId && (
                  <p className="truncate text-xs text-slate-500">
                    Por defecto: {categoryNames.get(m.defaultCategoryId) ?? m.defaultCategoryId}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1 text-xs">
                <button
                  type="button"
                  onClick={() => setViewing(m)}
                  className="rounded px-2 py-1 text-slate-300 hover:bg-slate-800"
                >
                  Ver
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(m)}
                  className="rounded px-2 py-1 text-slate-300 hover:bg-slate-800"
                >
                  Editar
                </button>
                {m.archivedAt === null && merchants.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setMerging(m)}
                    className="rounded px-2 py-1 text-slate-300 hover:bg-slate-800"
                  >
                    Fusionar
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setArchivingOrUnarchiving(m)}
                  className="rounded px-2 py-1 text-red-400 hover:bg-red-950/60"
                >
                  {m.archivedAt === null ? 'Archivar' : 'Reactivar'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <MerchantFormModal
        open={creating}
        onClose={() => setCreating(false)}
        profileId={profileId}
        categories={categories}
        tags={tags}
        onSaved={reload}
      />
      <MerchantFormModal
        open={editing !== null}
        onClose={() => setEditing(null)}
        profileId={profileId}
        categories={categories}
        tags={tags}
        onSaved={reload}
        merchant={editing}
      />
      <MerchantDetailModal
        open={viewing !== null}
        onClose={() => setViewing(null)}
        profileId={profileId}
        merchant={viewing}
        merchants={merchants}
        onChanged={reload}
      />
      <MergeMerchantsModal
        open={merging !== null}
        onClose={() => setMerging(null)}
        profileId={profileId}
        source={merging}
        merchants={merchants}
        onMerged={reload}
      />
      <CandidateGroupsModal
        open={candidatesOpen}
        onClose={() => setCandidatesOpen(false)}
        profileId={profileId}
        onCreated={reload}
      />

      <ConfirmDialog
        open={archivingOrUnarchiving !== null}
        onClose={() => setArchivingOrUnarchiving(null)}
        title={archivingOrUnarchiving?.archivedAt === null ? 'Archivar comercio' : 'Reactivar comercio'}
        message={
          archivingOrUnarchiving ? (
            <span>
              {archivingOrUnarchiving.archivedAt === null ? (
                <>
                  Vas a archivar <strong className="text-slate-100">{archivingOrUnarchiving.canonicalName}</strong>.
                  Los movimientos ya asociados conservan la asociacion; dejara de sugerirse para
                  movimientos nuevos.
                </>
              ) : (
                <>
                  Vas a reactivar <strong className="text-slate-100">{archivingOrUnarchiving.canonicalName}</strong>.
                </>
              )}
            </span>
          ) : null
        }
        buttons={archiveButtons}
      />
    </section>
  );
}
