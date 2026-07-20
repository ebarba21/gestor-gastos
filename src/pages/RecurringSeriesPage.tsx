// Pagina Recurrencias: series confirmables, proximos cobros y forecast (ver
// specs/FINANCIAL_ALGORITHMS.md seccion 7). La logica vive en recurringSeriesService/
// forecastService y en la seccion.
import { RecurringSeriesSection } from '../components/recurring';

export default function RecurringSeriesPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <RecurringSeriesSection />
    </div>
  );
}
