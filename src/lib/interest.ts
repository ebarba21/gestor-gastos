// Utilidades de tipos de interes y redondeo para deudas (ampliacion, fase 8). Ver
// FINANCIAL_ALGORITHMS.md secciones 2 y 8. Tipos siempre enteros en micro-fraccion 1e-6
// (annualRatePpm). Nunca floats para acumular dinero: el interes mensual se calcula con un
// intermedio BigInt y se redondea half-up UNA sola vez.
import { ValidationError } from './validation';
import { assertCents } from './money';

// Comprueba que un valor es una tasa/tolerancia valida en micro-fraccion 1e-6 (entero >= 0).
export function assertPpm(ppm: number): void {
  if (!Number.isInteger(ppm) || ppm < 0) {
    throw new ValidationError('El tipo de interes debe ser un entero >= 0 en micro-fraccion 1e-6.');
  }
}

// Redondeo half-up en valor absoluto de numerator/denominator (BigInt, denominator > 0).
// Ejemplo: 5/2 -> 3 (mitad hacia arriba); -5/2 -> -3 (mitad hacia arriba EN VALOR ABSOLUTO,
// no hacia +Infinito). Unica funcion de redondeo de esta capa (FINANCIAL_ALGORITHMS seccion 2).
export function roundHalfUpDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new ValidationError('El divisor de un redondeo debe ser positivo.');
  }
  const sign = numerator < 0n ? -1n : 1n;
  const abs = numerator < 0n ? -numerator : numerator;
  const quotient = abs / denominator;
  const remainder = abs % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return sign * rounded;
}

// Interes mensual sobre un saldo, en centimos. Formula (FINANCIAL_ALGORITHMS 2, 8.1):
// round_half_up(saldo_cents * annualRatePpm / (12 * 1_000_000)). NUNCA se pre-divide la tasa
// por 12 como entero (truncaria). El intermedio usa BigInt porque saldo*tasa puede superar 2^53.
export function monthlyInterestCents(balanceCents: number, annualRatePpm: number): number {
  assertCents(balanceCents);
  assertPpm(annualRatePpm);
  if (balanceCents < 0) {
    throw new ValidationError('El saldo para calcular intereses no puede ser negativo.');
  }
  const numerator = BigInt(balanceCents) * BigInt(annualRatePpm);
  const cents = roundHalfUpDiv(numerator, 12_000_000n);
  return Number(cents);
}

// Cuota constante que amortiza `principalCents` en `termMonths` periodos mensuales a
// `annualRatePpm` (FINANCIAL_ALGORITHMS 8.2). Tasa 0: cuota = round_half_up(P / n) (reparto
// entero exacto, sin intermedio flotante). Tasa > 0: formula de anualidad estandar; el termino
// (1+r)^-n exige un intermedio de coma flotante de doble precision (permitido explicitamente
// por el documento SOLO para este calculo puntual, nunca para acumular dinero); se redondea a
// centimo una unica vez con half-up (Math.round redondea half-up para valores positivos, que es
// siempre el caso de una cuota).
export function computeInstallmentCents(
  principalCents: number,
  annualRatePpm: number,
  termMonths: number,
): number {
  assertCents(principalCents);
  assertPpm(annualRatePpm);
  if (!Number.isInteger(termMonths) || termMonths < 1) {
    throw new ValidationError('El plazo debe ser un entero >= 1 mes.');
  }
  if (principalCents <= 0) {
    throw new ValidationError('El principal debe ser positivo para calcular una cuota.');
  }
  if (annualRatePpm === 0) {
    return Number(roundHalfUpDiv(BigInt(principalCents), BigInt(termMonths)));
  }
  const r = annualRatePpm / (12 * 1_000_000);
  const real = (principalCents * r) / (1 - Math.pow(1 + r, -termMonths));
  return Math.round(real);
}
