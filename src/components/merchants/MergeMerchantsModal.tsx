// Fusion de comercios: el comercio `source` desaparece de las listas (queda archivado, nunca
// se borra) y todos sus alias y movimientos pasan al comercio `target` elegido. Muestra los
// recuentos ANTES de confirmar (merchantService.previewMerge) y permite deshacer justo
// despues de fusionar (mientras el snapshot sigue en memoria; no es un deshacer persistente
// entre sesiones). Toda la logica vive en merchantService/merchantsRepo (transaccional).
import { useEffect, useState } from 'react';
import type { Merchant } from '../../db/schema';
import type { MerchantMergeSnapshot } from '../../db/merchantsRepo';
import { Modal } from '../common';
import { useToast } from '../../context/ToastContext';
import { merchantService } from '../../services/merchantService';

const selectClass =
  'mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500';

interface MergeMerchantsModalProps {
  open: boolean;
  onClose: () => void;
  profileId: string;
  source: Merchant | null;
  merchants: Merchant[]; // candidatos a destino (se excluye el propio source)
  onMerged: () => void | Promise<void>;
}

interface MergeDone {
  movedAliases: number;
  movedTransactions: number;
  targetName: string;
  snapshot: MerchantMergeSnapshot;
}

export function MergeMerchantsModal({
  open,
  onClose,
  profileId,
  source,
  merchants,
  onMerged,
}: MergeMerchantsModalProps) {
  const { showToast } = useToast();
  const [targetId, setTargetId] = useState('');
  const [preview, setPreview] = useState<{ aliases: number; transactions: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<MergeDone | null>(null);

  const candidates = merchants.filter((m) => m.id !== source?.id);

  useEffect(() => {
    if (!open || !source) return;
    setTargetId('');
    setError(null);
    setDone(null);
    void merchantService.previewMerge(profileId, source.id).then(setPreview);
  }, [open, source, profileId]);

  if (!source) return null;

  async function confirmMerge() {
    if (!targetId) return;
    setBusy(true);
    setError(null);
    try {
      const target = candidates.find((m) => m.id === targetId);
      const result = await merchantService.mergeMerchants(profileId, source!.id, targetId);
      setDone({
        movedAliases: result.movedAliases,
        movedTransactions: result.movedTransactions,
        targetName: target?.canonicalName ?? 'destino',
        snapshot: result.snapshot,
      });
      await onMerged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo fusionar el comercio.');
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!done) return;
    setBusy(true);
    try {
      await merchantService.undoMerge(profileId, done.snapshot);
      showToast('Fusion deshecha.', 'success');
      await onMerged();
      setDone(null);
      onClose();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo deshacer la fusion.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title="Fusionar comercio" dismissible={!busy}>
      {done ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-300">
            <strong className="text-slate-100">{source.canonicalName}</strong> se fusiono en{' '}
            <strong className="text-slate-100">{done.targetName}</strong>: se movieron{' '}
            {done.movedAliases} alias y {done.movedTransactions} movimiento(s). El comercio original
            queda archivado (no se borra).
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => void undo()}
              disabled={busy}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            >
              Deshacer
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Listo
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-300">
            Vas a fusionar <strong className="text-slate-100">{source.canonicalName}</strong> dentro
            de otro comercio. Sus alias y movimientos pasaran al destino; el origen quedará
            archivado (reversible justo después de confirmar).
          </p>

          {preview && (
            <p className="text-xs text-slate-500">
              {source.canonicalName} tiene {preview.aliases} alias y {preview.transactions}{' '}
              movimiento(s) que se moverian.
            </p>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-300">Fusionar dentro de</label>
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className={selectClass}>
              <option value="">Elige el comercio destino</option>
              {candidates.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.canonicalName}
                </option>
              ))}
            </select>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-lg px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void confirmMerge()}
              disabled={busy || targetId === ''}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
            >
              {busy ? 'Fusionando...' : 'Fusionar'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
