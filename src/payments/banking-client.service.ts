import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { callService, HTTP_TIMEOUTS } from '../common/http/internal-http';

export interface AccountInfo {
  id: string;
  accountNumber: string;
  accountType: string;
  idUser: string;
  currency: string;
  status: string;
}

export interface MerchantAccount {
  id: string;
  accountNumber: string;
  currency: string;
  status: string;
}

/**
 * Llamadas servicio a servicio (red interna, INTERNAL_API_KEY propia de
 * payment-service): cuentas en account-service, pagos en ledger-service y
 * clave dinámica en auth-service. Errores: regla común de common/http/internal-http.ts.
 */
@Injectable()
export class BankingClientService {
  constructor(private readonly config: ConfigService) {}

  /** Datos de una cuenta (titular, tipo, estado y moneda) para validar el origen del pago. */
  async getAccount(accountId: string): Promise<AccountInfo> {
    return callService<AccountInfo>(
      `${this.url('ACCOUNT_SERVICE_URL', 'http://localhost:3002')}/internal/accounts/${encodeURIComponent(accountId)}/ledger-info`,
      { headers: this.internalHeaders(), timeoutMs: HTTP_TIMEOUTS.read, retry: true },
      {
        service: 'Account Service',
        internal: true,
        on: { 404: () => new NotFoundException('Cuenta de origen no encontrada.') },
      },
    );
  }

  /** Crea u obtiene la cuenta de comercio del convenio (idempotente por código). */
  async ensureMerchantAccount(code: string, name: string, currency: string): Promise<MerchantAccount> {
    return callService<MerchantAccount>(
      `${this.url('ACCOUNT_SERVICE_URL', 'http://localhost:3002')}/internal/accounts/merchants`,
      { method: 'POST', headers: this.internalHeaders(), body: JSON.stringify({ code, name, currency }) },
      { service: 'Account Service', internal: true },
    );
  }

  /**
   * Pago cliente → convenio en el ledger (doble partida, saldo, límites e
   * idempotencia). No se reintenta solo: el cliente reintenta la confirmación
   * y la misma idempotencyKey evita cobrar dos veces.
   */
  async pay(params: {
    sourceAccountId: string;
    merchantAccountId: string;
    amount: number;
    idempotencyKey: string;
    description: string;
  }): Promise<{ id?: string }> {
    return callService<{ id?: string }>(
      `${this.url('LEDGER_SERVICE_URL', 'http://localhost:3006')}/ledger/internal/payments`,
      {
        method: 'POST',
        headers: this.internalHeaders(),
        body: JSON.stringify(params),
        timeoutMs: HTTP_TIMEOUTS.slow,
      },
      {
        service: 'Ledger Service',
        internal: true,
        unavailable: 'No se pudo completar el pago en este momento. Puedes reintentar la confirmación.',
      },
    );
  }

  /**
   * Pago desde la cuenta de sistema "Recompensas" a un comercio (canje de puntos).
   * No toca el saldo del cliente. Idempotente por idempotencyKey en el ledger.
   */
  async payFromRewards(params: {
    merchantAccountId: string;
    beneficiaryUserId: string;
    amount: number;
    idempotencyKey: string;
    description: string;
  }): Promise<{ id?: string }> {
    return callService<{ id?: string }>(
      `${this.url('LEDGER_SERVICE_URL', 'http://localhost:3006')}/ledger/internal/rewards`,
      {
        method: 'POST',
        headers: this.internalHeaders(),
        body: JSON.stringify({
          target: 'merchant',
          accountId: params.merchantAccountId,
          beneficiaryUserId: params.beneficiaryUserId,
          amount: params.amount,
          idempotencyKey: params.idempotencyKey,
          description: params.description,
        }),
        timeoutMs: HTTP_TIMEOUTS.slow,
      },
      { service: 'Ledger Service', internal: true },
    );
  }

  /** Valida la clave dinámica con Auth Service. */
  async verifyDynamicKey(userId: string, code: string): Promise<void> {
    const payload = await callService<{ valid?: boolean; message?: string }>(
      `${this.url('AUTH_SERVICE_URL', 'http://localhost:3001')}/internal/dynamic-key/verify`,
      { method: 'POST', headers: this.internalHeaders(), body: JSON.stringify({ idUser: userId, code }) },
      {
        service: 'Auth Service',
        internal: true,
        unavailable: 'No se pudo validar la clave dinámica. Inténtalo de nuevo.',
      },
    );
    if (payload?.valid !== true) {
      throw new BadRequestException(payload?.message || 'Clave dinámica incorrecta o vencida.');
    }
  }

  private url(key: string, fallback: string) {
    return this.config.get<string>(key, fallback).replace(/\/+$/, '');
  }

  private internalHeaders() {
    const key = this.config.get<string>('INTERNAL_API_KEY');
    if (!key) throw new ServiceUnavailableException('INTERNAL_API_KEY no está configurada en Payment Service.');
    return { 'Content-Type': 'application/json', 'x-internal-key': key };
  }
}
