// Fila deslizable para listas en el movil (noviembre 2026). Deslizar hacia la derecha ejecuta la
// accion "leading" (segura y reversible: confirmar, resolver, categorizar) y hacia la izquierda
// la "trailing" (abre opciones o descarta, siempre con deshacer o confirmacion en el destino).
//
// Accesibilidad: el gesto es un atajo. Cada accion debe existir tambien como boton visible en la
// propia fila o en su detalle (nunca solo con gesto). Solo reacciona a toques (pointerType
// 'touch' o 'pen'): con raton la fila funciona como siempre. touch-action: pan-y deja el
// desplazamiento vertical al navegador; si el dedo se mueve mas en vertical que en horizontal, el
// gesto se cancela.
import { useRef, useState, type ReactNode } from 'react';

export interface SwipeAction {
  label: string;
  onTrigger: () => void;
  className: string; // color de fondo y texto del rastro, p. ej. 'bg-emerald-600 text-white'
}

// Distancia minima (px) para que soltar ejecute la accion.
export const SWIPE_THRESHOLD_PX = 80;
const MAX_TRAVEL_PX = 120;

// Decide que accion dispara un desplazamiento horizontal al soltar. Pura (testeable).
export function swipeOutcome(dx: number, threshold = SWIPE_THRESHOLD_PX): 'leading' | 'trailing' | null {
  if (dx >= threshold) return 'leading';
  if (dx <= -threshold) return 'trailing';
  return null;
}

export function SwipeRow({
  children,
  leading,
  trailing,
  className = '',
}: {
  children: ReactNode;
  leading?: SwipeAction;
  trailing?: SwipeAction;
  className?: string;
}) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const locked = useRef<'h' | 'v' | null>(null);
  const moved = useRef(false);

  const reset = () => {
    start.current = null;
    locked.current = null;
    setDx(0);
  };

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {dx > 0 && leading && (
        <div className={`absolute inset-0 flex items-center px-4 text-sm font-semibold ${leading.className}`} aria-hidden="true">
          {leading.label}
        </div>
      )}
      {dx < 0 && trailing && (
        <div
          className={`absolute inset-0 flex items-center justify-end px-4 text-sm font-semibold ${trailing.className}`}
          aria-hidden="true"
        >
          {trailing.label}
        </div>
      )}
      <div
        className="relative h-full bg-slate-950"
        style={{
          transform: dx !== 0 ? `translateX(${dx}px)` : undefined,
          transition: start.current ? 'none' : 'transform 150ms ease-out',
          touchAction: 'pan-y',
        }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse') return;
          start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
          locked.current = null;
          moved.current = false;
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s || s.id !== e.pointerId) return;
          const mx = e.clientX - s.x;
          const my = e.clientY - s.y;
          if (locked.current === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) {
            locked.current = Math.abs(mx) > Math.abs(my) ? 'h' : 'v';
          }
          if (locked.current !== 'h') return;
          moved.current = true;
          let next = Math.max(-MAX_TRAVEL_PX, Math.min(MAX_TRAVEL_PX, mx));
          if (next > 0 && !leading) next = 0;
          if (next < 0 && !trailing) next = 0;
          setDx(next);
        }}
        onPointerUp={() => {
          const outcome = locked.current === 'h' ? swipeOutcome(dx) : null;
          reset();
          if (outcome === 'leading') leading?.onTrigger();
          else if (outcome === 'trailing') trailing?.onTrigger();
        }}
        onPointerCancel={reset}
        // Un deslizamiento no debe acabar abriendo la fila como si fuera un toque.
        onClickCapture={(e) => {
          if (moved.current) {
            e.stopPropagation();
            e.preventDefault();
            moved.current = false;
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
