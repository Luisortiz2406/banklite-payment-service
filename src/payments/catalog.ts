/**
 * Convenios de pago (facturas) y operadores de recarga. Cada empresa tiene una
 * cuenta de comercio real en BankLite (account-service, accountType 'merchant')
 * a la que llega el dinero por el ledger. Los códigos llevan prefijo para no
 * chocar con los comercios de suscripciones de card-service (mismo espacio de
 * merchantCode en account-service).
 */
export type BillerKind = 'bill' | 'topup' | 'qr';

export interface PayService {
  key: string;
  name: string;
  // Rango del valor simulado de la factura (COP).
  minAmount: number;
  maxAmount: number;
}

export interface CatalogItem {
  code: string;
  name: string;
  kind: BillerKind;
  // Facturas: servicio al que pertenece la empresa (agua, energía, ...).
  service: string | null;
  // Comercios de prueba del QR: valor fijo (0 = lo escribe quien paga) y concepto.
  qrAmount?: number;
  qrNote?: string;
}

export const PAY_SERVICES: PayService[] = [
  { key: 'agua', name: 'Agua', minAmount: 45_000, maxAmount: 180_000 },
  { key: 'energia', name: 'Energía', minAmount: 60_000, maxAmount: 260_000 },
  { key: 'gas', name: 'Gas', minAmount: 15_000, maxAmount: 70_000 },
  { key: 'internet', name: 'Internet', minAmount: 70_000, maxAmount: 150_000 },
  { key: 'telefonia', name: 'Telefonía', minAmount: 30_000, maxAmount: 90_000 },
  { key: 'tv', name: 'Televisión', minAmount: 40_000, maxAmount: 120_000 },
  { key: 'admin', name: 'Administración', minAmount: 150_000, maxAmount: 450_000 },
];

const bill = (code: string, name: string, service: string): CatalogItem => ({
  code: `fac-${code}`,
  name,
  kind: 'bill',
  service,
});
const topup = (code: string, name: string): CatalogItem => ({
  code: `rec-${code}`,
  name,
  kind: 'topup',
  service: null,
});
const store = (code: string, name: string, qrAmount: number, qrNote: string): CatalogItem => ({
  code: `qr-${code}`,
  name,
  kind: 'qr',
  service: null,
  qrAmount,
  qrNote,
});

export const BILLER_CATALOG: CatalogItem[] = [
  bill('acueducto', 'Acueducto de Bogotá', 'agua'),
  bill('epm-aguas', 'EPM Aguas', 'agua'),
  bill('aguas-cartagena', 'Aguas de Cartagena', 'agua'),
  bill('emcali', 'Emcali', 'agua'),
  bill('aqualia', 'Aqualia', 'agua'),
  bill('veolia', 'Veolia', 'agua'),
  bill('enel', 'Enel Colombia', 'energia'),
  bill('epm-energia', 'EPM Energía', 'energia'),
  bill('air-e', 'Air-e', 'energia'),
  bill('celsia', 'Celsia', 'energia'),
  bill('afinia', 'Afinia', 'energia'),
  bill('vanti', 'Vanti', 'gas'),
  bill('epm-gas', 'EPM Gas', 'gas'),
  bill('gases-occidente', 'Gases de Occidente', 'gas'),
  bill('surtigas', 'Surtigas', 'gas'),
  bill('gases-caribe', 'Gases del Caribe', 'gas'),
  bill('claro-hogar', 'Claro Hogar', 'internet'),
  bill('movistar-fibra', 'Movistar Fibra', 'internet'),
  bill('tigo-hogar', 'Tigo Hogar', 'internet'),
  bill('etb', 'ETB', 'internet'),
  bill('tel-claro', 'Claro', 'telefonia'),
  bill('tel-movistar', 'Movistar', 'telefonia'),
  bill('tel-tigo', 'Tigo', 'telefonia'),
  bill('tel-wom', 'WOM', 'telefonia'),
  bill('directv', 'DirecTV', 'tv'),
  bill('claro-tv', 'Claro TV', 'tv'),
  bill('tigo-tv', 'Tigo TV', 'tv'),
  bill('administracion', 'Administración de conjunto', 'admin'),
  topup('claro', 'Claro'),
  topup('movistar', 'Movistar'),
  topup('tigo', 'Tigo'),
  topup('wom', 'WOM'),
  topup('virgin', 'Virgin Mobile'),
  // Comercios de prueba para pagar con QR (cuentas de comercio reales en BankLite).
  store('cafe-la-esquina', 'Café La Esquina', 8_500, 'Café y pandebono'),
  store('el-trigal', 'Panadería El Trigal', 12_300, 'Pan y leche'),
  store('tienda-don-pepe', 'Tienda Don Pepe', 0, ''),
  store('taxi-wmx482', 'Taxi · Placa WMX 482', 0, 'Carrera de taxi'),
];

// Número de contrato o referencia de la factura y celular de la recarga.
export const BILL_REFERENCE = /^\d{6,14}$/;
export const PHONE = /^3\d{9}$/;

// Recargas: entre $1.000 y $500.000, en pesos enteros.
export const TOPUP_MIN = 1_000;
export const TOPUP_MAX = 500_000;
export const TOPUP_TYPES = ['Recarga de saldo', 'Paquete de datos', 'Paquete de minutos', 'Todo incluido'] as const;

// Pagos con QR a comercios: valor libre entre $1.000 y $5.000.000.
export const QR_MIN = 1_000;
export const QR_MAX = 5_000_000;

// Facturas inscritas por cliente.
export const MAX_SAVED_BILLS = 20;

export function catalogItem(code: string): CatalogItem | undefined {
  return BILLER_CATALOG.find((item) => item.code === code);
}

export function payService(key: string | null): PayService | undefined {
  return PAY_SERVICES.find((service) => service.key === key);
}

/** Deja la referencia como la guarda el convenio: sin espacios. */
export function normalizeReference(value: string): string {
  return String(value ?? '').replace(/\s+/g, '');
}
