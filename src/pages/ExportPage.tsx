// Pagina Exportaciones (ruta /exportar). Toda la logica vive en ExportSection y en los
// servicios de exportacion/backup; aqui solo se monta la seccion.
import { ExportSection } from '../components/export';

export default function ExportPage() {
  return <ExportSection />;
}
