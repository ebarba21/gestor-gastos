// Pagina Presupuestos y metas: monta la seccion. La logica de calculo vive en
// budgetService (reutilizando statsService) y la UI en components/budgets (ver
// specs/ARCHITECTURE.md).
import { BudgetsSection } from '../components/budgets';

export default function BudgetsPage() {
  return <BudgetsSection />;
}
