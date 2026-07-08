// Pagina Movimientos: listado, filtros, CRUD, acciones masivas y movimientos especiales
// del perfil activo. La logica vive en la seccion y en transactionService.
import { TransactionsSection } from '../components/transactions';

export default function TransactionsPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <TransactionsSection />
    </div>
  );
}
