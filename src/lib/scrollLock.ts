// Bloqueo del scroll del documento mientras hay capas superpuestas abiertas (modales, panel
// "Mas" de la navegacion movil). Lleva un contador para que capas anidadas (p. ej. el detalle de
// un movimiento abierto desde el desglose del dashboard) no desbloqueen el fondo al cerrarse
// la de encima. Bloquea html y body: en iOS, con la PWA instalada, bloquear solo body no basta
// y el gesto acaba desplazando la pagina de fondo en vez de la capa.

let locks = 0;
let prevHtmlOverflow = '';
let prevBodyOverflow = '';

export function lockDocumentScroll(): () => void {
  if (typeof document === 'undefined') return () => {};
  if (locks === 0) {
    prevHtmlOverflow = document.documentElement.style.overflow;
    prevBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }
  locks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks -= 1;
    if (locks === 0) {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
    }
  };
}

// Solo para tests: numero de bloqueos activos.
export function activeScrollLocks(): number {
  return locks;
}
