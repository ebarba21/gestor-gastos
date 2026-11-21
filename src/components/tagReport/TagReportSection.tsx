// Informe por etiqueta (noviembre 2026): cuanto costo un viaje o un proyecto etiquetado,
// repartido por categoria, subcategoria y comercio, con su coste por dia.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Tag } from '../../db/schema';
import { useActiveProfileId } from '../../hooks/useProfiles';
import { useMerchants } from '../../hooks/useMerchants';
import { tagReportService, type TagReport, type TagReportLine } from '../../services/tagReportService';
import { formatCents } from '../../lib/money';
import { EmptyState } from '../common';

function Lines({ title, lines, total }: { title: string; lines: TagReportLine[]; total: number }) {
  if (lines.length === 0) return null;
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <h3 className="mb-2 text-sm font-semibold text-slate-200">{title}</h3>
      <ul className="space-y-2 text-sm">
        {lines.map((l) => {
          const share = total > 0 ? Math.max(0, Math.min(100, Math.round((l.cents * 100) / total))) : 0;
          return (
            <li key={`${l.id ?? 'none'}-${l.label}`}>
              <div className="flex justify-between gap-3">
                <span className="min-w-0 truncate text-slate-300">{l.label}</span>
                <span className="shrink-0 tabular-nums text-slate-100">
                  {formatCents(l.cents)}
                  {total > 0 && l.cents > 0 && <span className="ml-1 text-xs text-slate-500">{share} %</span>}
                </span>
              </div>
              {l.cents > 0 && (
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-800" aria-hidden="true">
                  <div className="h-full rounded-full bg-indigo-500" style={{ width: `${share}%` }} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function TagReportSection() {
  const profileId = useActiveProfileId();
  const { merchants } = useMerchants();
  const merchantNames = useMemo(() => new Map(merchants.map((m) => [m.id, m.canonicalName])), [merchants]);
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [tagId, setTagId] = useState('');
  const [report, setReport] = useState<TagReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    tagReportService
      .listTags(profileId)
      .then((list) => {
        if (cancelled) return;
        const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name, 'es'));
        setTags(sorted);
        setTagId((cur) => cur || sorted[0]?.id || '');
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'No se pudieron cargar las etiquetas.'));
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  useEffect(() => {
    if (!tagId) {
      setReport(null);
      return;
    }
    let cancelled = false;
    setError(null);
    tagReportService
      .compute(profileId, tagId, merchantNames)
      .then((r) => !cancelled && setReport(r))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'No se pudo calcular el informe.'));
    return () => {
      cancelled = true;
    };
  }, [profileId, tagId, merchantNames]);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Informe por etiqueta</h2>
        <p className="mt-1 text-sm text-slate-400">
          Lo que costó un viaje o un proyecto etiquetado, aunque sus gastos estén en varias categorías. Los Bizum y
          reembolsos enlazados a sus gastos restan.
        </p>
      </div>

      {error && <p className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</p>}

      {tags !== null && tags.length === 0 ? (
        <EmptyState
          icon="🏷️"
          title="Aún no tienes etiquetas"
          description="Crea una en Categorías (por ejemplo, Viaje Lisboa 2026) y ponla en los gastos del viaje, a mano o con una regla."
        />
      ) : (
        tags !== null && (
          <label className="block text-sm text-slate-300">
            Etiqueta
            <select
              value={tagId}
              onChange={(e) => setTagId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
            >
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )
      )}

      {report && report.movementCount === 0 && (
        <p className="text-sm text-slate-400">Esta etiqueta no tiene gastos que cuenten en estadísticas.</p>
      )}

      {report && report.movementCount > 0 && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-xs text-slate-500">Coste neto</p>
              <p className="text-lg font-semibold tabular-nums text-slate-100">{formatCents(report.netCents)}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-xs text-slate-500">Por día</p>
              <p className="text-lg font-semibold tabular-nums text-slate-100">
                {report.perDayCents !== null ? formatCents(report.perDayCents) : 'Sin datos'}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-xs text-slate-500">Días</p>
              <p className="text-lg font-semibold tabular-nums text-slate-100">{report.days}</p>
              <p className="text-[11px] text-slate-500">
                {report.firstDate} a {report.lastDate}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-xs text-slate-500">Devuelto</p>
              <p className="text-lg font-semibold tabular-nums text-slate-100">{formatCents(report.returnedCents)}</p>
              <p className="text-[11px] text-slate-500">Bruto {formatCents(report.grossCents)}</p>
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <Lines title="Por categoría" lines={report.byCategory} total={report.netCents} />
            <Lines title="Por subcategoría" lines={report.bySubcategory} total={report.netCents} />
            <Lines title="Comercios principales" lines={report.byMerchant} total={report.netCents} />
          </div>
          <Link
            to={`/movimientos?q=${encodeURIComponent(`#${report.tagName}`)}`}
            className="inline-block text-sm text-indigo-400 hover:underline"
          >
            Ver sus {report.movementCount} movimientos
          </Link>
        </>
      )}
    </section>
  );
}
