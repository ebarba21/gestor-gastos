// Seccion de cuentas: CRUD, archivar/restaurar y borrado con regla de integridad (una
// cuenta con movimientos no se puede borrar; se ofrece archivar). El saldo actual se
// mostrara cuando existan movimientos (fases posteriores); aqui se ve el saldo inicial.
import { useState } from 'react';
import type { Account } from '../../db/schema';
import { useAccounts } from '../../hooks/useAccounts';
import { accountService, ACCOUNT_KIND_LABELS } from '../../services/accountService';
import { formatCents } from '../../lib/money';
import { EmptyState, ConfirmDialog, type DialogButton } from '../common';
import { useToast } from '../../context/ToastContext';
import { AccountFormModal } from './AccountFormModal';

export function AccountsSection() {
  const { profileId, accounts, loading, error, reload } = useAccounts();
  const { showToast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [deleting, setDeleting] = useState<Account | null>(null);

  async function archive(acc: Account) {
    await accountService.archiveAccount(profileId, acc.id);
    showToast('Cuenta archivada.', 'info');
    await reload();
  }
  async function unarchive(acc: Account) {
    await accountService.unarchiveAccount(profileId, acc.id);
    showToast('Cuenta restaurada.', 'success');
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
                  await accountService.archiveAccount(profileId, deleting.id);
                  showToast('Cuenta archivada.', 'info');
                  await reload();
                },
              },
            ]
          : []),
        {
          label: 'Eliminar',
          variant: 'danger' as const,
          onClick: async () => {
            await accountService.deleteAccount(profileId, deleting.id);
            showToast('Cuenta eliminada.', 'success');
            await reload();
          },
        },
      ]
    : [];

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-100">Cuentas bancarias</h2>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Nueva cuenta
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading ? (
        <p className="text-sm text-slate-500">Cargando...</p>
      ) : accounts.length === 0 ? (
        <EmptyState
          icon="🏦"
          title="Sin cuentas"
          description="Crea tus fuentes de dinero (banco, tarjeta, efectivo, PayPal, cuenta conjunta...) para asignar los movimientos."
          action={
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Crear primera cuenta
            </button>
          }
        />
      ) : (
        <div className="space-y-2">
          {accounts.map((acc) => {
            const archived = acc.archivedAt !== null;
            return (
              <div
                key={acc.id}
                className={[
                  // En movil las acciones bajan a una segunda linea (flex-wrap) para que el
                  // nombre de la cuenta no quede comprimido por los botones secundarios.
                  'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2.5',
                  archived ? 'opacity-60' : '',
                ].join(' ')}
              >
                <span
                  className="h-8 w-8 shrink-0 rounded-full"
                  style={{ backgroundColor: acc.color ?? '#334155' }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-100">{acc.name}</p>
                  <p className="text-xs text-slate-500">{ACCOUNT_KIND_LABELS[acc.kind]}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-slate-200">{formatCents(acc.openingBalanceCents)}</p>
                  <p className="text-[11px] text-slate-500">Saldo inicial</p>
                </div>
                {archived && (
                  <span className="rounded bg-amber-900/40 px-1.5 py-0.5 text-[11px] text-amber-300">
                    Archivada
                  </span>
                )}
                {/* En movil el grupo de acciones ocupa toda la fila inferior y se alinea a la
                    derecha; en PC vuelve a su ancho natural en la misma linea. */}
                <div className="flex w-full shrink-0 justify-end gap-1 text-xs sm:w-auto">
                  {!archived ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setEditing(acc)}
                        className="rounded px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => void archive(acc)}
                        className="rounded px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                      >
                        Archivar
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void unarchive(acc)}
                      className="rounded px-2 py-1 text-emerald-400 hover:bg-slate-800"
                    >
                      Restaurar
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setDeleting(acc)}
                    className="rounded px-2 py-1 text-red-400 hover:bg-red-950/60"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AccountFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        profileId={profileId}
        onSaved={reload}
      />
      <AccountFormModal
        open={editing !== null}
        onClose={() => setEditing(null)}
        profileId={profileId}
        onSaved={reload}
        account={editing}
      />
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Eliminar cuenta"
        message={
          deleting ? (
            <span>
              Vas a eliminar la cuenta <strong className="text-slate-100">{deleting.name}</strong>.
              Si tiene movimientos no se podra eliminar: archivala para conservar el historico.
            </span>
          ) : null
        }
        buttons={deleteButtons}
      />
    </section>
  );
}
