// Selector de icono (emoji) opcional para categorias. Presets + opcion "Sin icono".
// Solo presentacion.
interface IconPickerProps {
  value: string | null;
  onChange: (icon: string | null) => void;
  label?: string;
}

const ICONS: readonly string[] = [
  '🏠',
  '🍽️',
  '🚗',
  '🩺',
  '🎬',
  '🛍️',
  '🎓',
  '📱',
  '💼',
  '💰',
  '✈️',
  '🐱',
  '🎁',
  '⚡',
  '💡',
  '🏦',
];

export function IconPicker({ value, onChange, label = 'Icono (opcional)' }: IconPickerProps) {
  return (
    <div>
      <span className="block text-sm font-medium text-slate-300">{label}</span>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-pressed={value === null}
          className={[
            'flex h-9 w-9 items-center justify-center rounded-lg border text-xs',
            value === null
              ? 'border-slate-400 bg-slate-700 text-slate-200'
              : 'border-slate-700 text-slate-400',
          ].join(' ')}
        >
          Sin
        </button>
        {ICONS.map((icon) => (
          <button
            key={icon}
            type="button"
            onClick={() => onChange(icon)}
            aria-pressed={value === icon}
            className={[
              'flex h-9 w-9 items-center justify-center rounded-lg border text-lg',
              value === icon ? 'border-slate-400 bg-slate-700' : 'border-slate-700',
            ].join(' ')}
          >
            {icon}
          </button>
        ))}
      </div>
    </div>
  );
}
