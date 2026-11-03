/**
 * Convenios de pago (facturas) y operadores de recarga. Los nombres son
 * ficticios: Banklite es un proyecto académico y no usa marcas reales, y
 * ninguno corresponde a una empresa real de Colombia.
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
  bill('acueducto', 'Acueducto Montecielo', 'agua'),
  bill('epm-aguas', 'Aguas de Piedralinda', 'agua'),
  bill('aguas-cartagena', 'Aguas de Bahía Serena', 'agua'),
  bill('emcali', 'Hidrocauce', 'agua'),
  bill('aqualia', 'Acueducto Valleluna', 'agua'),
  bill('veolia', 'Aguas Brisaclara', 'agua'),
  bill('enel', 'Energía Cumbre', 'energia'),
  bill('epm-energia', 'Voltaria', 'energia'),
  bill('air-e', 'Luz del Llano', 'energia'),
  bill('celsia', 'Fulgor Energía', 'energia'),
  bill('afinia', 'Energía Brisamar', 'energia'),
  bill('vanti', 'Gas Sabanero', 'gas'),
  bill('epm-gas', 'Gas del Río', 'gas'),
  bill('gases-occidente', 'Calorandes', 'gas'),
  bill('surtigas', 'Gasbahía', 'gas'),
  bill('gases-caribe', 'Gas Llamarada', 'gas'),
  bill('claro-hogar', 'Ondanet Hogar', 'internet'),
  bill('movistar-fibra', 'Telvia Fibra', 'internet'),
  bill('tigo-hogar', 'Celmar Hogar', 'internet'),
  bill('etb', 'Teleandes', 'internet'),
  bill('tel-claro', 'Ondanet', 'telefonia'),
  bill('tel-movistar', 'Telvia', 'telefonia'),
  bill('tel-tigo', 'Celmar', 'telefonia'),
  bill('tel-wom', 'Fonik', 'telefonia'),
  bill('directv', 'Satelvisión', 'tv'),
  bill('claro-tv', 'Ondanet TV', 'tv'),
  bill('tigo-tv', 'Celmar TV', 'tv'),
  bill('administracion', 'Administración de conjunto', 'admin'),
  topup('claro', 'Ondanet'),
  topup('movistar', 'Telvia'),
  topup('tigo', 'Celmar'),
  topup('wom', 'Fonik'),
  topup('virgin', 'Lumo Móvil'),
  // Comercios de prueba para pagar con QR (cuentas de comercio reales en BankLite).
  store('cafe-la-esquina', 'Café La Esquina', 8_500, 'Café y pandebono'),
  store('el-trigal', 'Panadería El Trigal', 12_300, 'Pan y leche'),
  store('tienda-don-pepe', 'Tienda Don Pepe', 0, ''),
  store('taxi-wmx482', 'Taxi · Placa WMX 482', 0, 'Carrera de taxi'),
];

// Nombres que se usaron antes: marcas reales y, después, los nombres "Demo".
// Las solicitudes viejas los tienen en description ("Agua · Acueducto de
// Bogotá · Ref. …"): al mostrarlas se traducen al nombre vigente. La base no
// se reescribe.
const LEGACY_NAMES: Readonly<Record<string, string>> = {
  'Acueducto de Bogotá': 'Acueducto Montecielo',
  'Aguas Demo Sabana': 'Acueducto Montecielo',
  'EPM Aguas': 'Aguas de Piedralinda',
  'Aguas Demo Montaña': 'Aguas de Piedralinda',
  'Aguas de Cartagena': 'Aguas de Bahía Serena',
  'Aguas Demo Bahía': 'Aguas de Bahía Serena',
  Emcali: 'Hidrocauce',
  'Aguas Demo Valle': 'Hidrocauce',
  Aqualia: 'Acueducto Valleluna',
  'Aguas Demo Río': 'Acueducto Valleluna',
  Veolia: 'Aguas Brisaclara',
  'Aguas Demo Manantial': 'Aguas Brisaclara',
  'Enel Colombia': 'Energía Cumbre',
  'Energía Demo Sabana': 'Energía Cumbre',
  'EPM Energía': 'Voltaria',
  'Energía Demo Montaña': 'Voltaria',
  'Air-e': 'Luz del Llano',
  'Energía Demo Brisa': 'Luz del Llano',
  Celsia: 'Fulgor Energía',
  'Energía Demo Valle': 'Fulgor Energía',
  Afinia: 'Energía Brisamar',
  'Energía Demo Costa': 'Energía Brisamar',
  Vanti: 'Gas Sabanero',
  'Gas Demo Sabana': 'Gas Sabanero',
  'EPM Gas': 'Gas del Río',
  'Gas Demo Montaña': 'Gas del Río',
  'Gases de Occidente': 'Calorandes',
  'Gas Demo Valle': 'Calorandes',
  Surtigas: 'Gasbahía',
  'Gas Demo Bahía': 'Gasbahía',
  'Gases del Caribe': 'Gas Llamarada',
  'Gas Demo Costa': 'Gas Llamarada',
  'Claro Hogar': 'Ondanet Hogar',
  'Internet Demo Colibrí': 'Ondanet Hogar',
  'Movistar Fibra': 'Telvia Fibra',
  'Internet Demo Tucán': 'Telvia Fibra',
  'Tigo Hogar': 'Celmar Hogar',
  'Internet Demo Guacamaya': 'Celmar Hogar',
  ETB: 'Teleandes',
  'Internet Demo Cóndor': 'Teleandes',
  Claro: 'Ondanet',
  'Móvil Demo Colibrí': 'Ondanet',
  Movistar: 'Telvia',
  'Móvil Demo Tucán': 'Telvia',
  Tigo: 'Celmar',
  'Móvil Demo Guacamaya': 'Celmar',
  WOM: 'Fonik',
  'Móvil Demo Toche': 'Fonik',
  'Virgin Mobile': 'Lumo Móvil',
  'Móvil Demo Turpial': 'Lumo Móvil',
  DirecTV: 'Satelvisión',
  'TV Demo Satélite': 'Satelvisión',
  'Claro TV': 'Ondanet TV',
  'TV Demo Colibrí': 'Ondanet TV',
  'Tigo TV': 'Celmar TV',
  'TV Demo Guacamaya': 'Celmar TV',
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
