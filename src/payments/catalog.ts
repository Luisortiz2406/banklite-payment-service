/**
 * Convenios de pago (facturas) y operadores de recarga. Los nombres son
 * inventados ("Demo"): Banklite es un proyecto académico y no usa marcas reales.
 * Los códigos (fac-claro-hogar, rec-tigo, ...) no cambian: los usan las facturas
 * inscritas, las solicitudes guardadas y las cuentas de comercio. Cada empresa tiene una
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
  bill('acueducto', 'Aguas Demo Sabana', 'agua'),
  bill('epm-aguas', 'Aguas Demo Montaña', 'agua'),
  bill('aguas-cartagena', 'Aguas Demo Bahía', 'agua'),
  bill('emcali', 'Aguas Demo Valle', 'agua'),
  bill('aqualia', 'Aguas Demo Río', 'agua'),
  bill('veolia', 'Aguas Demo Manantial', 'agua'),
  bill('enel', 'Energía Demo Sabana', 'energia'),
  bill('epm-energia', 'Energía Demo Montaña', 'energia'),
  bill('air-e', 'Energía Demo Brisa', 'energia'),
  bill('celsia', 'Energía Demo Valle', 'energia'),
  bill('afinia', 'Energía Demo Costa', 'energia'),
  bill('vanti', 'Gas Demo Sabana', 'gas'),
  bill('epm-gas', 'Gas Demo Montaña', 'gas'),
  bill('gases-occidente', 'Gas Demo Valle', 'gas'),
  bill('surtigas', 'Gas Demo Bahía', 'gas'),
  bill('gases-caribe', 'Gas Demo Costa', 'gas'),
  bill('claro-hogar', 'Internet Demo Colibrí', 'internet'),
  bill('movistar-fibra', 'Internet Demo Tucán', 'internet'),
  bill('tigo-hogar', 'Internet Demo Guacamaya', 'internet'),
  bill('etb', 'Internet Demo Cóndor', 'internet'),
  bill('tel-claro', 'Móvil Demo Colibrí', 'telefonia'),
  bill('tel-movistar', 'Móvil Demo Tucán', 'telefonia'),
  bill('tel-tigo', 'Móvil Demo Guacamaya', 'telefonia'),
  bill('tel-wom', 'Móvil Demo Toche', 'telefonia'),
  bill('directv', 'TV Demo Satélite', 'tv'),
  bill('claro-tv', 'TV Demo Colibrí', 'tv'),
  bill('tigo-tv', 'TV Demo Guacamaya', 'tv'),
  bill('administracion', 'Administración de conjunto', 'admin'),
  topup('claro', 'Móvil Demo Colibrí'),
  topup('movistar', 'Móvil Demo Tucán'),
  topup('tigo', 'Móvil Demo Guacamaya'),
  topup('wom', 'Móvil Demo Toche'),
  topup('virgin', 'Móvil Demo Turpial'),
  // Comercios de prueba para pagar con QR (cuentas de comercio reales en BankLite).
  store('cafe-la-esquina', 'Café La Esquina', 8_500, 'Café y pandebono'),
  store('el-trigal', 'Panadería El Trigal', 12_300, 'Pan y leche'),
  store('tienda-don-pepe', 'Tienda Don Pepe', 0, ''),
  store('taxi-wmx482', 'Taxi · Placa WMX 482', 0, 'Carrera de taxi'),
];

// Nombres que se usaron antes (marcas reales). Las solicitudes viejas los tienen
// en description ("Agua · Acueducto de Bogotá · Ref. …"): al mostrarlas se
// traducen al nombre nuevo. La base no se reescribe.
const LEGACY_NAMES: Readonly<Record<string, string>> = {
  'Acueducto de Bogotá': 'Aguas Demo Sabana',
  'EPM Aguas': 'Aguas Demo Montaña',
  'Aguas de Cartagena': 'Aguas Demo Bahía',
  Emcali: 'Aguas Demo Valle',
  Aqualia: 'Aguas Demo Río',
  Veolia: 'Aguas Demo Manantial',
  'Enel Colombia': 'Energía Demo Sabana',
  'EPM Energía': 'Energía Demo Montaña',
  'Air-e': 'Energía Demo Brisa',
  Celsia: 'Energía Demo Valle',
  Afinia: 'Energía Demo Costa',
  Vanti: 'Gas Demo Sabana',
  'EPM Gas': 'Gas Demo Montaña',
  'Gases de Occidente': 'Gas Demo Valle',
  Surtigas: 'Gas Demo Bahía',
  'Gases del Caribe': 'Gas Demo Costa',
  'Claro Hogar': 'Internet Demo Colibrí',
  'Movistar Fibra': 'Internet Demo Tucán',
  'Tigo Hogar': 'Internet Demo Guacamaya',
  ETB: 'Internet Demo Cóndor',
  Claro: 'Móvil Demo Colibrí',
  Movistar: 'Móvil Demo Tucán',
  Tigo: 'Móvil Demo Guacamaya',
  WOM: 'Móvil Demo Toche',
  'Virgin Mobile': 'Móvil Demo Turpial',
  DirecTV: 'TV Demo Satélite',
  'Claro TV': 'TV Demo Colibrí',
  'Tigo TV': 'TV Demo Guacamaya',
};

/**
 * Descripción con los nombres vigentes. Solo se miran los dos primeros tramos
 * (separados por " · "), que es donde va la empresa en facturas, recargas y
 * canjes; la nota que escribe el cliente en un pago QR va después y no se toca.
 */
export function currentDescription(description: string): string {
  const parts = description.split(' · ');
  for (let i = 0; i < Math.min(2, parts.length); i++) parts[i] = LEGACY_NAMES[parts[i]] ?? parts[i];
  return parts.join(' · ');
}

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

/** Topes de recargas que muestran el frontend y Banki (GET /payments/catalog, público). */
export function paymentsCatalog() {
  return { topup: { min: TOPUP_MIN, max: TOPUP_MAX, types: TOPUP_TYPES } };
}
