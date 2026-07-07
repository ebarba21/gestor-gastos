// Selector de color de acento a partir de una paleta fija. Solo presentacion.
import { ACCENT_COLORS } from '../../lib/colors';

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  label?: string;
}

export function ColorPicker({ value, onChange, label = 'Color' }: ColorPickerProps) {
  return (
    <div>
      <span className="block text-sm font-medium text-slate-300">{label}</span>
      <div className="mt-2 flex flex-wrap gap-2">
        {ACCENT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            aria-label={`Color ${c}`}
            aria-pressed={value === c}
            className={[
              'h-7 w-7 rounded-full border-2 transition',
              value === c ? 'border-white' : 'border-transparent',
            ].join(' ')}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
    </div>
  );
}
