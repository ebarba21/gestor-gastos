// Lista virtualizada minima (windowing) sin dependencias externas (coste 0). Renderiza
// solo las filas visibles + un margen (overscan), con altura de fila fija. Permite que el
// listado de movimientos siga fluido con decenas de miles de elementos.
//
// Presentacion pura: recibe los items ya filtrados/ordenados y una funcion de render por
// fila. No conoce logica de negocio.
import { useRef, useState, type ReactNode, type UIEvent } from 'react';

interface VirtualListProps<T> {
  items: T[];
  rowHeight: number;
  // Altura visible del contenedor con scroll (px).
  height: number;
  renderRow: (item: T, index: number) => ReactNode;
  keyFor: (item: T, index: number) => string;
  overscan?: number;
  className?: string;
}

export function VirtualList<T>({
  items,
  rowHeight,
  height,
  renderRow,
  keyFor,
  overscan = 6,
  className,
}: VirtualListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const total = items.length;
  const totalHeight = total * rowHeight;

  // Rango visible: primera y ultima fila a renderizar, con margen de overscan.
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(height / rowHeight) + overscan * 2;
  const last = Math.min(total, first + visibleCount);
  const offsetY = first * rowHeight;

  function onScroll(e: UIEvent<HTMLDivElement>) {
    setScrollTop(e.currentTarget.scrollTop);
  }

  const slice = items.slice(first, last);

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className={className}
      style={{ height, overflowY: 'auto', position: 'relative' }}
    >
      {/* Espaciador que reserva el alto total para que la barra de scroll sea correcta. */}
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {slice.map((item, i) => {
            const index = first + i;
            return (
              <div key={keyFor(item, index)} style={{ height: rowHeight }}>
                {renderRow(item, index)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
