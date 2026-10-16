import { createHash } from 'crypto';
import { PayService } from './catalog';

/**
 * Factura de DEMOSTRACIÓN. BankLite no está conectado a los convenios reales,
 * así que la factura del mes se deriva de (empresa, referencia, mes) con un
 * hash: la misma referencia siempre muestra el mismo valor y vencimiento
 * durante el mes, y otro valor el mes siguiente. Pagarla sí mueve dinero real
 * en el ledger (cliente → cuenta de la empresa).
 */
export interface SimulatedBill {
  // Mes en que se paga (YYYY-MM): una factura por empresa, referencia y mes.
  period: string;
  // Mes facturado (consumo): el anterior al de pago.
  billedPeriod: string;
  amount: number;
  dueDate: string; // YYYY-MM-DD
}

const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;

/** Fecha de hoy en Bogotá (YYYY-MM-DD). */
export function bogotaToday(): string {
  return new Date(Date.now() - BOGOTA_OFFSET_MS).toISOString().slice(0, 10);
}

function previousMonth(period: string): string {
  const [year, month] = period.split('-').map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}

export function simulatedBill(
  billerCode: string,
  service: PayService,
  reference: string,
  period = bogotaToday().slice(0, 7),
): SimulatedBill {
  const digest = createHash('sha256').update(`${billerCode}|${reference}|${period}`).digest();
  // Valor redondeado a $100, dentro del rango del servicio.
  const steps = Math.floor((service.maxAmount - service.minAmount) / 100);
  const amount = service.minAmount + (digest.readUInt32BE(0) % (steps + 1)) * 100;
  // Vence entre el 5 y el 24 del mes de pago.
  const day = 5 + (digest.readUInt32BE(4) % 20);
  return {
    period,
    billedPeriod: previousMonth(period),
    amount,
    dueDate: `${period}-${String(day).padStart(2, '0')}`,
  };
}
