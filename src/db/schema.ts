// Tipos de entidades del modelo de datos. Fuente unica de tipos (ver specs/DATA_MODEL.md).
// Convenciones: dinero en centimos enteros; id UUID string; timestamps epoch ms;
// enums como uniones de string literales; profileId obligatorio en toda entidad de datos.

// --- Enums (uniones de string literales) ---

export type AccountKind = 'bank' | 'card' | 'cash' | 'wallet' | 'shared' | 'other';
export type CategoryKind = 'expense' | 'income' | 'both';
export type TransactionType = 'expense' | 'income' | 'transfer';
export type TransactionStatus = 'cleared' | 'pending' | 'reconciled';
export type CategorizedBy = 'manual' | 'rule' | 'import' | 'none';
export type WeekStart = 'monday' | 'sunday';
export type StatsFlag = 0 | 1;

export type RuleMatchMode = 'all' | 'any';
export type RuleConditionField = 'concept' | 'amount' | 'date' | 'account' | 'type';
export type RuleConditionOperator =
  // texto (concept)
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'equals'
  | 'regex'
  // numerico (amount)
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'eq'
  | 'between'
  // fecha (date)
  | 'before'
  | 'after';

export type BudgetScope = 'category' | 'subcategory' | 'account' | 'overall';
export type BudgetDirection = 'expense' | 'income';
export type BudgetPeriod = 'monthly' | 'quarterly' | 'yearly' | 'custom';

export type SourceFormat = 'csv' | 'xlsx';
export type AmountStrategy = 'signed' | 'debitCredit';
export type DecimalSeparator = ',' | '.';
export type ThousandSeparator = ',' | '.' | '';
export type ImportBatchStatus = 'committed' | 'undone';

// --- Entidades ---

export interface Profile {
  id: string;
  name: string;
  color: string;
  avatarEmoji: string | null;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

export interface Setting {
  id: string;
  profileId: string;
  currency: string;
  locale: string;
  weekStart: WeekStart;
  defaultAccountId: string | null;
  // Reservado fase 2 (Web Crypto). En el MVP siempre false.
  encryptionEnabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Account {
  id: string;
  profileId: string;
  name: string;
  kind: AccountKind;
  currency: string;
  color: string | null;
  openingBalanceCents: number;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Category {
  id: string;
  profileId: string;
  name: string;
  // null = categoria raiz; con valor = subcategoria (un unico nivel en el MVP).
  parentId: string | null;
  kind: CategoryKind;
  color: string | null;
  icon: string | null;
  archivedAt: number | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface Tag {
  id: string;
  profileId: string;
  name: string;
  color: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Transaction {
  id: string;
  profileId: string;
  // Fecha contable YYYY-MM-DD (sin hora ni zona horaria).
  date: string;
  // Entero en centimos. Gasto negativo, ingreso positivo.
  amountCents: number;
  type: TransactionType;
  concept: string;
  notes: string | null;
  accountId: string;
  categoryId: string | null;
  subcategoryId: string | null;
  tagIds: string[];
  status: TransactionStatus;
  categorizedBy: CategorizedBy;
  ruleId: string | null;
  transferGroupId: string | null;
  parentId: string | null;
  isSplitParent: boolean;
  refundOfId: string | null;
  excludedFromStats: boolean;
  // Espejo indexable de excludedFromStats (1 = excluido). Lo mantiene el repositorio.
  statsFlag: StatsFlag;
  importBatchId: string | null;
  dedupeHash: string;
  createdAt: number;
  updatedAt: number;
}

export interface RuleCondition {
  field: RuleConditionField;
  operator: RuleConditionOperator;
  value: string | number;
  value2: string | number | null;
  caseSensitive: boolean;
}

export interface RuleAction {
  setCategoryId: string | null;
  setSubcategoryId: string | null;
  addTagIds: string[];
  setExcludedFromStats: boolean | null;
}

export interface Rule {
  id: string;
  profileId: string;
  name: string;
  enabled: boolean;
  // Menor numero = mayor prioridad.
  priority: number;
  matchMode: RuleMatchMode;
  conditions: RuleCondition[];
  action: RuleAction;
  stopOnMatch: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Budget {
  id: string;
  profileId: string;
  name: string;
  scope: BudgetScope;
  scopeId: string | null;
  direction: BudgetDirection;
  limitCents: number;
  period: BudgetPeriod;
  customStart: string | null;
  customEnd: string | null;
  rollover: boolean;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

// Mapeo columna->campo del fichero importado. Valor = nombre o indice de columna.
export interface ColumnMap {
  date: string | number;
  concept: string | number;
  amount: string | number | null;
  debit: string | number | null;
  credit: string | number | null;
  account: string | number | null;
  notes: string | number | null;
}

export interface ImportTemplate {
  id: string;
  profileId: string;
  name: string;
  sourceFormat: SourceFormat;
  columnMap: ColumnMap;
  dateFormat: string;
  decimalSeparator: DecimalSeparator;
  thousandSeparator: ThousandSeparator;
  amountStrategy: AmountStrategy;
  defaultAccountId: string | null;
  hasHeaderRow: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ImportBatch {
  id: string;
  profileId: string;
  templateId: string | null;
  fileName: string;
  importedAt: number;
  rowsTotal: number;
  rowsImported: number;
  rowsSkippedDuplicate: number;
  status: ImportBatchStatus;
  createdAt: number;
  updatedAt: number;
}
