// Pagina Importar datos: wizard fichero -> mapeo/plantilla -> preview/duplicados -> commit.
// La logica vive en la seccion y en importService (ver specs/ARCHITECTURE.md seccion 5.1).
import { ImportSection } from '../components/import';

export default function ImportPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <ImportSection />
    </div>
  );
}
