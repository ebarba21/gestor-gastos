// Tests de interaccion del dashboard: las tarjetas Ingresos/Gastos abren su desglose y las
// filas (desglose y top gastos) abren la ficha del movimiento pulsado.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DrillDown, IncomeExpenseSummary, TopExpense } from '../../services/statsService';
import { StatTiles } from './StatTiles';
import { MovementsDrillDownModal } from './MovementsDrillDownModal';
import { TopExpensesCard } from './TopExpensesCard';

const summary: IncomeExpenseSummary = {
  incomeCents: 150000,
  expenseGrossCents: 4000,
  refundCents: 500,
  positiveExpenseCents: 0,
  expenseNetCents: 3500,
  netSavingsCents: 146500,
  savingsContribCents: 0,
  investmentContribCents: 0,
  savingsRatePerMille: 977,
};

const categoryNames = new Map([['cat-food', 'Alimentacion']]);
const accountNames = new Map([['acc-1', 'Ibercaja']]);

describe('StatTiles pulsables', () => {
  it('pulsar Ingresos y Gastos llama a su handler', async () => {
    const onOpenIncome = vi.fn();
    const onOpenExpenses = vi.fn();
    render(<StatTiles summary={summary} onOpenIncome={onOpenIncome} onOpenExpenses={onOpenExpenses} />);
    await userEvent.click(screen.getByRole('button', { name: /ver ingresos/i }));
    await userEvent.click(screen.getByRole('button', { name: /ver gastos/i }));
    expect(onOpenIncome).toHaveBeenCalledTimes(1);
    expect(onOpenExpenses).toHaveBeenCalledTimes(1);
  });

  it('sin handlers las tarjetas no son botones', () => {
    render(<StatTiles summary={summary} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('MovementsDrillDownModal', () => {
  const drillDown: DrillDown = {
    totalCents: 3500,
    items: [
      { id: 'r1', date: '2026-07-10', concept: 'Devolucion', accountId: 'acc-1', categoryId: 'cat-food', role: 'refund', contributionCents: -500 },
      { id: 'g1', date: '2026-07-05', concept: 'Mercadona', accountId: 'acc-1', categoryId: 'cat-food', role: 'expense', contributionCents: 4000 },
    ],
  };

  it('lista los movimientos con su total y abre el pulsado', async () => {
    const onSelectMovement = vi.fn();
    render(
      <MovementsDrillDownModal
        open
        onClose={() => {}}
        kind="expense"
        drillDown={drillDown}
        filterName="Alimentacion"
        categoryNames={categoryNames}
        accountNames={accountNames}
        onSelectMovement={onSelectMovement}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Gastos del periodo' })).toBeInTheDocument();
    expect(screen.getByText(/2 movimiento\(s\)/)).toBeInTheDocument();
    expect(screen.getByText('Reembolso')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Mercadona'));
    expect(onSelectMovement).toHaveBeenCalledWith('g1');
  });

  it('muestra estado vacio sin movimientos', () => {
    render(
      <MovementsDrillDownModal
        open
        onClose={() => {}}
        kind="income"
        drillDown={{ items: [], totalCents: 0 }}
        filterName={null}
        categoryNames={categoryNames}
        accountNames={accountNames}
        onSelectMovement={() => {}}
      />,
    );
    expect(screen.getByText('Sin ingresos en este periodo.')).toBeInTheDocument();
  });
});

describe('TopExpensesCard', () => {
  it('pulsar un gasto abre su ficha (no cambia el filtro)', async () => {
    const top: TopExpense[] = [
      { id: 'g1', date: '2026-07-05', concept: 'Mercadona', amountCents: 4000, categoryId: 'cat-food', accountId: 'acc-1' },
    ];
    const onSelectMovement = vi.fn();
    render(
      <TopExpensesCard
        topExpenses={top}
        categoryNames={categoryNames}
        accountNames={accountNames}
        activeCategoryId="cat-food"
        onSelectMovement={onSelectMovement}
      />,
    );
    await userEvent.click(screen.getByText('Mercadona'));
    expect(onSelectMovement).toHaveBeenCalledWith('g1');
  });
});

describe('detalle de un mes de los graficos mensuales', () => {
  it('muestra los totales del mes y el aviso de filtro, y cerrar llama a onClose', async () => {
    const { MonthMovementsModal } = await import('./MonthMovementsModal');
    const onClose = vi.fn();
    render(
      <MonthMovementsModal
        open
        onClose={onClose}
        monthLabel="junio de 2026"
        drillDown={{ income: { items: [], totalCents: 200000 }, expense: { items: [], totalCents: 45000 } }}
        filterName={null}
        categoryNames={categoryNames}
        accountNames={accountNames}
        onSelectMovement={vi.fn()}
        closeHint="Al cerrar, el dashboard se filtrará por junio de 2026."
      />,
    );
    expect(screen.getByText(/se filtrará por junio de 2026/i)).toBeInTheDocument();
    expect(screen.getByText(/1550,00/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
