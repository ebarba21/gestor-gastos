// Primitivas estadisticas puras y deterministas para deteccion de recurrencias
// (FINANCIAL_ALGORITHMS seccion 7.1: mediana + dispersion robusta, no media/desviacion
// sensibles a outliers). Sin dependencias externas.

// Mediana de una lista de centimos enteros. Con numero par de elementos, la mediana es la
// media de los dos centrales redondeada half-up al centimo (regla unica de FINANCIAL_ALGORITHMS
// seccion 2 y 7.1). Lanza si la lista esta vacia (contrato explicito, sin silenciar el caso).
export function medianCents(values: number[]): number {
  if (values.length === 0) {
    throw new Error('medianCents requiere al menos un valor.');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  const a = sorted[mid - 1]!;
  const b = sorted[mid]!;
  // half-up en valor absoluto de la media de los dos centrales.
  const sum = a + b;
  return sum >= 0 ? Math.round(sum / 2) : -Math.round(-sum / 2);
}

// Desviacion absoluta mediana (MAD): mediana de |x - mediana(x)|. Medida de dispersion
// robusta frente a outliers (a diferencia de la desviacion estandar). Se usa en centimos
// enteros; el redondeo half-up de medianCents ya se aplica en el calculo interno.
export function medianAbsoluteDeviation(values: number[]): number {
  if (values.length === 0) {
    throw new Error('medianAbsoluteDeviation requiere al menos un valor.');
  }
  const med = medianCents(values);
  const deviations = values.map((v) => Math.abs(v - med));
  return medianCents(deviations);
}

// Mediana simple de numeros no monetarios (p. ej. separaciones en dias). Mismo criterio
// half-up para numero par de elementos, sin exigir enteros de centimos.
export function medianNumber(values: number[]): number {
  if (values.length === 0) {
    throw new Error('medianNumber requiere al menos un valor.');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  const a = sorted[mid - 1]!;
  const b = sorted[mid]!;
  const sum = a + b;
  return sum >= 0 ? Math.round(sum / 2) : -Math.round(-sum / 2);
}

// Moda (valor mas frecuente) de una lista de enteros. Empate: gana el valor mas pequeno,
// para que el resultado sea determinista y reproducible.
export function mode(values: number[]): number {
  if (values.length === 0) {
    throw new Error('mode requiere al menos un valor.');
  }
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0]!;
  let bestCount = 0;
  for (const [v, c] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}
