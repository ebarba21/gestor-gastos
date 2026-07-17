// Registro central de entidades sincronizables (fase 2). Une el nombre logico local
// (SyncEntityType), la tabla remota (RemoteTableName) y el ORDEN de dependencias para el push.
//
// El orden respeta las claves foraneas: una cuenta antes que sus movimientos, categorias y
// reglas antes que los movimientos que las referencian, plantillas antes que lotes, etc. Dentro
// de `transaction` el orden por createdAt coloca normalmente el padre de un split antes que sus
// hijas; si una hija llegara antes, la FK compuesta la rechaza y se reintenta tras el padre.
import type { RemoteTableName } from '../remote';
import type { SyncEntityType } from '../db/schema';

interface EntityInfo {
  entityType: SyncEntityType;
  remoteTable: RemoteTableName;
  // Nombre del store Dexie local (camelCase, difiere del remoto snake_case).
  localTable: string;
  // Menor = se sube antes (dependencias). Ver nota de cabecera.
  order: number;
  // La raiz `profile` no tiene profileId propio (su id ES el profileId de sus hijos).
  hasProfileId: boolean;
  // Entidad financiera: los conflictos se resuelven SIEMPRE de forma explicita por la persona
  // (invariante 11). Las no financieras (setting) admiten last-write-wins documentado.
  financial: boolean;
}

export const ENTITY_REGISTRY: Record<SyncEntityType, EntityInfo> = {
  profile: {
    entityType: 'profile',
    remoteTable: 'profiles',
    localTable: 'profiles',
    order: 0,
    hasProfileId: false,
    financial: true,
  },
  account: {
    entityType: 'account',
    remoteTable: 'accounts',
    localTable: 'accounts',
    order: 1,
    hasProfileId: true,
    financial: true,
  },
  category: {
    entityType: 'category',
    remoteTable: 'categories',
    localTable: 'categories',
    order: 2,
    hasProfileId: true,
    financial: true,
  },
  tag: {
    entityType: 'tag',
    remoteTable: 'tags',
    localTable: 'tags',
    order: 3,
    hasProfileId: true,
    financial: true,
  },
  rule: {
    entityType: 'rule',
    remoteTable: 'rules',
    localTable: 'rules',
    order: 4,
    hasProfileId: true,
    financial: true,
  },
  importTemplate: {
    entityType: 'importTemplate',
    remoteTable: 'import_templates',
    localTable: 'importTemplates',
    order: 5,
    hasProfileId: true,
    financial: true,
  },
  importBatch: {
    entityType: 'importBatch',
    remoteTable: 'import_batches',
    localTable: 'importBatches',
    order: 6,
    hasProfileId: true,
    financial: true,
  },
  setting: {
    entityType: 'setting',
    remoteTable: 'settings',
    localTable: 'settings',
    order: 7,
    hasProfileId: true,
    // No financiera: last-write-wins documentado, sin conflicto visible (DATA_MODEL 12).
    financial: false,
  },
  budget: {
    entityType: 'budget',
    remoteTable: 'budgets',
    localTable: 'budgets',
    order: 8,
    hasProfileId: true,
    financial: true,
  },
  // Comercios (fase 4): deben subir ANTES que transactions, que puede referenciarlos por
  // merchantId (FK compuesta profile_id+merchant_id en remoto).
  merchant: {
    entityType: 'merchant',
    remoteTable: 'merchants',
    localTable: 'merchants',
    order: 9,
    hasProfileId: true,
    financial: true,
  },
  merchantAlias: {
    entityType: 'merchantAlias',
    remoteTable: 'merchant_aliases',
    localTable: 'merchantAliases',
    order: 10,
    hasProfileId: true,
    financial: true,
  },
  transaction: {
    entityType: 'transaction',
    remoteTable: 'transactions',
    localTable: 'transactions',
    order: 11,
    hasProfileId: true,
    financial: true,
  },
  // Decisiones de "no duplicado" (fase 5): referencian movimientos por id opcional, se suben
  // DESPUES de transactions para que esa referencia ya exista en remoto.
  noDuplicateDecision: {
    entityType: 'noDuplicateDecision',
    remoteTable: 'no_duplicate_decisions',
    localTable: 'noDuplicateDecisions',
    order: 12,
    hasProfileId: true,
    // No es un movimiento financiero en si (no tiene importe): es una decision de
    // clasificacion. Se trata igualmente como financiera porque afecta a que se presenta como
    // "posible duplicado" en dinero real; sin merge automatico de campos.
    financial: true,
  },
  // Bandeja de revision (fase 6): entityId referencia movimientos/lotes/conflictos ya subidos,
  // se sube DESPUES de transactions y importBatch.
  reviewItem: {
    entityType: 'reviewItem',
    remoteTable: 'review_items',
    localTable: 'reviewItems',
    order: 13,
    hasProfileId: true,
    // Afecta a flujos de dinero real (duplicados, transferencias, reembolsos candidatos):
    // mismo criterio que noDuplicateDecision, sin merge automatico de campos.
    financial: true,
  },
  // Conciliacion bancaria (fase 6): referencia una cuenta, se sube DESPUES de accounts.
  reconciliation: {
    entityType: 'reconciliation',
    remoteTable: 'reconciliations',
    localTable: 'reconciliations',
    order: 14,
    hasProfileId: true,
    // Snapshot de saldo real: conflictos financieros, nunca merge silencioso.
    financial: true,
  },
  // Recurrencias (fase 7): la serie referencia opcionalmente un comercio, se sube DESPUES de
  // merchants. Las ocurrencias referencian la serie y opcionalmente un movimiento, se suben
  // DESPUES de recurringSeries y de transactions.
  recurringSeries: {
    entityType: 'recurringSeries',
    remoteTable: 'recurring_series',
    localTable: 'recurringSeries',
    order: 15,
    hasProfileId: true,
    financial: true,
  },
  recurringOccurrence: {
    entityType: 'recurringOccurrence',
    remoteTable: 'recurring_occurrences',
    localTable: 'recurringOccurrences',
    order: 16,
    hasProfileId: true,
    financial: true,
  },
  // Deudas (fase 8): la deuda referencia opcionalmente una cuenta y una categoria (ya subidas,
  // order 1 y 2), se sube DESPUES de ambas. Los pagos y escenarios referencian la deuda, se
  // suben DESPUES de debt.
  debt: {
    entityType: 'debt',
    remoteTable: 'debts',
    localTable: 'debts',
    order: 17,
    hasProfileId: true,
    financial: true,
  },
  debtPayment: {
    entityType: 'debtPayment',
    remoteTable: 'debt_payments',
    localTable: 'debtPayments',
    order: 18,
    hasProfileId: true,
    financial: true,
  },
  debtScenario: {
    entityType: 'debtScenario',
    remoteTable: 'debt_scenarios',
    localTable: 'debtScenarios',
    order: 19,
    hasProfileId: true,
    // Simulacion guardada, no un movimiento real, pero afecta a decisiones sobre dinero real:
    // mismo criterio que reviewItem/noDuplicateDecision, sin merge automatico de campos.
    financial: true,
  },
};

// Orden de dependencias para el PUSH (ascendente) y para la subida en migracion/reconstruccion.
export const PUSH_ORDER: SyncEntityType[] = (
  Object.values(ENTITY_REGISTRY) as EntityInfo[]
)
  .slice()
  .sort((a, b) => a.order - b.order)
  .map((info) => info.entityType);

// Entidades hijas (con profileId), en orden de dependencias. Se usa para descargar/subir todo un
// perfil sin la raiz.
export const CHILD_PUSH_ORDER: SyncEntityType[] = PUSH_ORDER.filter(
  (type) => ENTITY_REGISTRY[type].hasProfileId,
);
