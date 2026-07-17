// Panel de detalle y acciones de una tarea de la bandeja de revision. Cada tipo explica que
// ocurre, por que, y ofrece las acciones propias de ARCHITECTURE seccion 17 / DATA_MODEL
// seccion 16. Toda accion real (categorizar, vincular, eliminar, crear comercio...) llama al
// servicio correspondiente y despues resuelve/descarta la tarea; nunca se resuelve en
// silencio (invariante 11 de CLAUDE.md).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ReviewItem, Transaction } from '../../db/schema';
import { Modal } from '../common';
import { transactionsRepo } from '../../db/transactionsRepo';
import { categoryService, type CategoryNode } from '../../services/categoryService';
import { merchantService } from '../../services/merchantService';
import { transactionService } from '../../services/transactionService';
import { reviewService, REVIEW_TYPE_LABELS } from '../../services/reviewService';
import { formatCents } from '../../lib/money';

interface ReviewItemDetailModalProps {
  profileId: string;
  item: ReviewItem;
  onClose: () => void;
  onChanged: () => void;
}

const LOCALE = 'es-ES';
const CURRENCY = 'EUR';

const selectClass =
  'w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-slate-500';
const buttonPrimary =
  'rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50';
const buttonGhost =
  'rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50';
const buttonDanger =
  'rounded-lg border border-red-800 px-3 py-1.5 text-sm text-red-300 hover:bg-red-950 disabled:opacity-50';

function TxSummary({ tx, label }: { tx: Transaction; label?: string }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3">
      {label && <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>}
      <p className="text-slate-100">{tx.concept}</p>
      <p className="text-xs text-slate-400">
        {tx.date} · {formatCents(tx.amountCents, LOCALE, CURRENCY)}
      </p>
    </div>
  );
}

export function ReviewItemDetailModal({
  profileId,
  item,
  onClose,
  onChanged,
}: ReviewItemDetailModalProps) {
  const [tx, setTx] = useState<Transaction | null>(null);
  const [counterpart, setCounterpart] = useState<Transaction | null>(null);
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [merchantName, setMerchantName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (item.entityType === 'transaction') {
        const t = await transactionsRepo.getById(profileId, item.entityId);
        if (!cancelled) setTx(t ?? null);
      }
      const counterpartId =
        (item.metadata.counterpartId as string | undefined) ??
        (item.metadata.originalId as string | undefined);
      if (counterpartId) {
        const c = await transactionsRepo.getById(profileId, counterpartId);
        if (!cancelled) setCounterpart(c ?? null);
      }
      if (item.type === 'uncategorized' || item.type === 'lowConfidenceRule') {
        const tree = await categoryService.listTree(profileId, { includeArchived: false });
        if (!cancelled) setCategories(tree);
      }
      if (item.type === 'newMerchant') {
        const concept = String(item.metadata.normalizedConcept ?? '');
        if (!cancelled) {
          setMerchantName(concept.replace(/\b\w/g, (c) => c.toUpperCase()));
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [profileId, item]);

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo completar la accion.');
    } finally {
      setBusy(false);
    }
  }

  const errors = item.type === 'importError' ? (item.metadata.errors as
    | { row: number; reason: string }[]
    | undefined) ?? [] : [];
  const sampleCount = item.type === 'newMerchant'
    ? ((item.metadata.sampleTransactionIds as string[] | undefined)?.length ?? 0)
    : 0;

  return (
    <Modal open onClose={onClose} title={REVIEW_TYPE_LABELS[item.type]} dismissible={!busy}>
      <div className="space-y-4 text-sm">
        {tx && <TxSummary tx={tx} />}
        {tx && (
          <Link to="/movimientos" className="inline-block text-xs text-indigo-400 underline">
            Ver en movimientos
          </Link>
        )}

        {item.reasonCodes.length > 0 && (
          <p className="text-xs text-slate-400">Motivos: {item.reasonCodes.join(', ')}</p>
        )}
        {item.confidence > 0 && (
          <p className="text-xs text-slate-500">Confianza orientativa: {Math.round(item.confidence / 10)}%</p>
        )}
        {error && <p className="text-red-400">{error}</p>}

        {/* --- Sin categorizar --- */}
        {item.type === 'uncategorized' && tx && (
          <div className="space-y-2">
            <p className="text-slate-300">Este movimiento no tiene categoria asignada.</p>
            <label className="block text-xs text-slate-400" htmlFor="review-category-select">
              Categoria
            </label>
            <select
              id="review-category-select"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className={selectClass}
            >
              <option value="">Elegir categoria...</option>
              {categories.map((node) => (
                <optgroup key={node.category.id} label={node.category.name}>
                  <option value={node.category.id}>{node.category.name}</option>
                  {node.children.map((c) => (
                    <option key={c.id} value={c.id}>
                      {node.category.name} / {c.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={busy || !categoryId}
                className={buttonPrimary}
                onClick={() =>
                  run(async () => {
                    await transactionService.bulkEdit(profileId, [tx.id], {
                      setCategory: { categoryId, subcategoryId: null },
                    });
                    await reviewService.resolve(profileId, item.id, 'categorized');
                  })
                }
              >
                Categorizar y resolver
              </button>
            </div>
          </div>
        )}

        {/* --- Regla de baja confianza --- */}
        {item.type === 'lowConfidenceRule' && tx && (
          <div className="space-y-2">
            <p className="text-slate-300">
              Una regla categorizo este movimiento, pero con poca certeza (coincidencia debil).
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                className={buttonGhost}
                onClick={() => run(() => reviewService.resolve(profileId, item.id, 'rule:accepted'))}
              >
                Aceptar la categoria
              </button>
              <button
                type="button"
                disabled={busy}
                className={buttonPrimary}
                onClick={() =>
                  run(async () => {
                    await transactionService.bulkEdit(profileId, [tx.id], {
                      setCategory: { categoryId: null, subcategoryId: null },
                    });
                    await reviewService.resolve(profileId, item.id, 'rule:rejected');
                  })
                }
              >
                Quitar categoria
              </button>
            </div>
          </div>
        )}

        {/* --- Posible duplicado (reutiliza el motor de duplicados, ya calculado) --- */}
        {item.type === 'possibleDuplicate' && tx && (
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              className={buttonGhost}
              onClick={() => run(() => reviewService.resolve(profileId, item.id, 'markedNotDuplicate'))}
            >
              No es un duplicado
            </button>
            <button
              type="button"
              disabled={busy}
              className={buttonDanger}
              onClick={() =>
                run(async () => {
                  await transactionService.remove(profileId, tx.id);
                  await reviewService.resolve(profileId, item.id, 'deleted');
                })
              }
            >
              Eliminar este movimiento
            </button>
          </div>
        )}

        {/* --- Transferencia candidata --- */}
        {item.type === 'transferCandidate' && tx && (
          <div className="space-y-2">
            {counterpart ? (
              <TxSummary tx={counterpart} label="Posible pareja" />
            ) : (
              <p className="text-slate-400">El movimiento con el que se pareo ya no esta disponible.</p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                className={buttonGhost}
                onClick={() => run(() => reviewService.dismiss(profileId, item.id, 'not-a-transfer'))}
              >
                No es una transferencia
              </button>
              <button
                type="button"
                disabled={busy || !counterpart}
                className={buttonPrimary}
                onClick={() =>
                  run(async () => {
                    await transactionService.linkAsTransfer(profileId, tx.id, counterpart!.id);
                    await reviewService.resolve(profileId, item.id, 'linked:transfer');
                  })
                }
              >
                Vincular como transferencia
              </button>
            </div>
          </div>
        )}

        {/* --- Reembolso candidato --- */}
        {item.type === 'refundCandidate' && tx && (
          <div className="space-y-2">
            {counterpart ? (
              <TxSummary tx={counterpart} label="Gasto original" />
            ) : (
              <p className="text-slate-400">El gasto original ya no esta disponible.</p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                className={buttonGhost}
                onClick={() => run(() => reviewService.dismiss(profileId, item.id, 'not-a-refund'))}
              >
                No es un reembolso
              </button>
              <button
                type="button"
                disabled={busy || !counterpart}
                className={buttonPrimary}
                onClick={() =>
                  run(async () => {
                    await transactionService.markAsRefund(profileId, tx.id, counterpart!.id);
                    await reviewService.resolve(profileId, item.id, 'linked:refund');
                  })
                }
              >
                Vincular como reembolso
              </button>
            </div>
          </div>
        )}

        {/* --- Pendiente antiguo --- */}
        {item.type === 'stalePending' && tx && (
          <div className="space-y-2">
            <p className="text-slate-300">
              Este movimiento lleva {String(item.metadata.ageDays ?? '?')} dia(s) marcado como pendiente
              sin confirmarse.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                className={buttonGhost}
                onClick={() => run(() => reviewService.snooze(profileId, item.id, Date.now() + 7 * 86_400_000))}
              >
                Aplazar 7 dias
              </button>
              <button
                type="button"
                disabled={busy}
                className={buttonDanger}
                onClick={() =>
                  run(async () => {
                    await transactionService.remove(profileId, tx.id);
                    await reviewService.resolve(profileId, item.id, 'deleted');
                  })
                }
              >
                Eliminar
              </button>
              <button
                type="button"
                disabled={busy}
                className={buttonPrimary}
                onClick={() =>
                  run(async () => {
                    await transactionsRepo.update(profileId, tx.id, { pending: false });
                    await reviewService.resolve(profileId, item.id, 'confirmed');
                  })
                }
              >
                Confirmar
              </button>
            </div>
          </div>
        )}

        {/* --- Comercio nuevo --- */}
        {item.type === 'newMerchant' && tx && (
          <div className="space-y-2">
            <p className="text-slate-300">
              {sampleCount > 0
                ? `Este concepto aparece en ${sampleCount + 1} movimientos sin comercio asociado.`
                : 'Este movimiento no tiene un comercio asociado.'}
            </p>
            <label className="block text-xs text-slate-400" htmlFor="review-merchant-name">
              Nombre del comercio
            </label>
            <input
              id="review-merchant-name"
              value={merchantName}
              onChange={(e) => setMerchantName(e.target.value)}
              className={selectClass}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                className={buttonGhost}
                onClick={() => run(() => reviewService.resolve(profileId, item.id, 'merchant:skipped'))}
              >
                Dejar sin comercio
              </button>
              <button
                type="button"
                disabled={busy || merchantName.trim().length === 0}
                className={buttonPrimary}
                onClick={() =>
                  run(async () => {
                    const merchant = await merchantService.create(profileId, {
                      canonicalName: merchantName.trim(),
                    });
                    const sampleIds = (item.metadata.sampleTransactionIds as string[] | undefined) ?? [];
                    for (const id of [tx.id, ...sampleIds]) {
                      await merchantService.setTransactionMerchant(profileId, id, merchant.id);
                    }
                    await reviewService.resolve(profileId, item.id, 'merchant:created');
                  })
                }
              >
                Crear comercio y asociar
              </button>
            </div>
          </div>
        )}

        {/* --- Error de importacion --- */}
        {item.type === 'importError' && (
          <div className="space-y-2">
            <p className="text-slate-300">
              {errors.length} fila(s) de este lote no se pudieron importar.
            </p>
            <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-slate-300">
              {errors.map((e, i) => (
                <li key={i} className="rounded border border-slate-800 bg-slate-900/60 p-2">
                  Fila {e.row}: {e.reason}
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-500">
              Corrige el fichero de origen y vuelve a importarlo; esas filas no crean movimientos.
            </p>
          </div>
        )}

        {/* --- Conflicto de sincronizacion --- */}
        {item.type === 'syncConflict' && (
          <div className="space-y-2">
            <p className="text-slate-300">
              Hay una edicion simultanea sin resolver entre dispositivos para esta entidad.
            </p>
            <Link
              to="/sincronizacion"
              className="inline-block text-indigo-400 underline"
              onClick={onClose}
            >
              Ir a sincronizacion para resolverlo
            </Link>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-800 pt-3">
          <button
            type="button"
            disabled={busy}
            className={buttonGhost}
            onClick={() => run(() => reviewService.dismiss(profileId, item.id))}
          >
            Descartar tarea
          </button>
          <button type="button" disabled={busy} className={buttonGhost} onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </Modal>
  );
}
