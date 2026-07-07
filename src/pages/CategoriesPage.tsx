// Pagina Categorias: categorias, subcategorias y etiquetas del perfil activo.
import { CategoriesSection, TagsSection } from '../components/categories';

export default function CategoriesPage() {
  return (
    <div className="max-w-3xl space-y-10">
      <CategoriesSection />
      <TagsSection />
    </div>
  );
}
