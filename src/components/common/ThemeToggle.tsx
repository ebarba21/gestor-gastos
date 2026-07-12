// Conmutador de tema (oscuro / claro). Dos variantes:
//  - "icon": boton compacto con icono, para la barra lateral.
//  - "segmented": control con dos opciones etiquetadas, para la pagina de Ajustes.
import { useTheme } from '../../context/ThemeContext';

interface ThemeToggleProps {
  variant?: 'icon' | 'segmented';
  className?: string;
}

export function ThemeToggle({ variant = 'icon', className = '' }: ThemeToggleProps) {
  const { theme, setTheme, toggleTheme } = useTheme();

  if (variant === 'segmented') {
    const optionClass = (active: boolean): string =>
      [
        'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
        active ? 'bg-slate-800 text-slate-50' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200',
      ].join(' ');
    return (
      <div className={`inline-flex rounded-lg bg-slate-950 p-0.5 ${className}`} role="group" aria-label="Tema">
        <button
          type="button"
          onClick={() => setTheme('dark')}
          className={optionClass(theme === 'dark')}
          aria-pressed={theme === 'dark'}
        >
          <span aria-hidden>🌙</span> Oscuro
        </button>
        <button
          type="button"
          onClick={() => setTheme('light')}
          className={optionClass(theme === 'light')}
          aria-pressed={theme === 'light'}
        >
          <span aria-hidden>☀️</span> Claro
        </button>
      </div>
    );
  }

  const nextLabel = theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={nextLabel}
      aria-label={nextLabel}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 text-base text-slate-300 hover:bg-slate-800 ${className}`}
    >
      <span aria-hidden>{theme === 'dark' ? '☀️' : '🌙'}</span>
    </button>
  );
}
