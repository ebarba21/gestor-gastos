// Candidatos de comercio: agrupa los movimientos SIN comercio por concepto normalizado (los
// mas frecuentes primero) para que el usuario revise y decida crear un comercio a partir de un
// grupo. Nunca fusiona ni asocia nada por si solo (DATA_MODEL 14: "no fusiones debiles"). Al
// crear, se anade un alias EXACTO para ese concepto normalizado y se aplica el motor
// retroactivamente para vincular esos movimientos de inmediato.
import { useEffect, useState } from 'react';
import { Modal, EmptyState } from '../common';
import { useToast } from '../../context/ToastContext';
import { merchantService, type MerchantConceptGroup } from '../../services/merchantService';
import { formatCents } from '../../lib/money';

const inputClass =
  'rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-slate-500';

interface CandidateGroupsModalProps {
  open: boolean;
  onClose: () => void;
  profileId: string;
  onCreated: () => void | Promise<void>;
}

export function CandidateGroupsModal({ open, onClose, profileId, onCreated }: CandidateGroupsModalProps) {
  const { showToast } = useToast();
  const [groups, setGroups] = useState<MerchantConceptGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const result = await merchantService.listUnlinkedConceptGroups(profileId, { limit: 50 });
      setGroups(result);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudieron cargar los candidatos.', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void load();
  }, [open, profileId]);

  async function createFromGroup(group: MerchantConceptGroup) {
    const name = (drafts[group.normalizedConcept] ?? group.sampleRawConcept).trim();
    if (name.length === 0) return;
    setCreating(group.normalizedConcept);
    try {
      const { changed } = await merchantService.createFromCandidate(profileId, name, group.sampleRawConcept);
      showToast(`Comercio "${name}" creado. ${changed} movimiento(s) vinculados.`, 'success');
      await load();
      await onCreated();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo crear el comercio.', 'error');
    } finally {
      setCreating(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Movimientos sin comercio">
      <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
        <p className="text-sm text-slate-400">
          Tus movimientos sin comercio, agrupados por concepto (los más frecuentes primero). Al
          crear un comercio desde un grupo, se vinculan esos movimientos al instante; puedes
          añadir más variantes (alias) después desde la ficha del comercio.
        </p>

        {loading ? (
          <p className="text-sm text-slate-500">Cargando...</p>
        ) : groups.length === 0 ? (
          <EmptyState
            icon="🏷️"
            title="Sin candidatos"
            description="No hay movimientos sin comercio que agrupar, o ya están todos asociados."
          />
        ) : (
          <div className="space-y-2">
            {groups.map((g) => (
              <div
                key={g.normalizedConcept}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-200">{g.sampleRawConcept}</p>
                  <p className="text-xs text-slate-500">
                    {g.count} movimiento(s) · {formatCents(g.totalAmountCents, 'es-ES', 'EUR')}
                  </p>
                </div>
                <input
                  type="text"
                  value={drafts[g.normalizedConcept] ?? g.sampleRawConcept}
                  onChange={(e) =>
                    setDrafts((cur) => ({ ...cur, [g.normalizedConcept]: e.target.value }))
                  }
                  className={`${inputClass} w-40`}
                />
                <button
                  type="button"
                  onClick={() => void createFromGroup(g)}
                  disabled={creating !== null}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {creating === g.normalizedConcept ? 'Creando...' : 'Crear comercio'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
