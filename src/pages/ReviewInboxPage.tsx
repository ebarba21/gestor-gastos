// Pagina Bandeja de revision: cola unificada de excepciones (ver specs/ARCHITECTURE.md
// seccion 17). La logica vive en reviewService y en la seccion.
import { ReviewInboxSection } from '../components/review';

export default function ReviewInboxPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <ReviewInboxSection />
    </div>
  );
}
