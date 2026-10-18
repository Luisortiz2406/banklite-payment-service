import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
 * clave dinámica en auth-service.
 */
@Injectable()
export class BankingClientService {
  constructor(private readonly config: ConfigService) {}

  /** Datos de una cuenta (titular, tipo, estado y moneda) para validar el origen del pago. */
  async getAccount(accountId: string): Promise<AccountInfo> {
    const baseUrl = this.config.get<string>('ACCOUNT_SERVICE_URL', 'http://localhost:3002');
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/internal/accounts/${encodeURIComponent(accountId)}/ledger-info`, {
        headers: this.internalHeaders(),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new ServiceUnavailableException('No se pudo contactar Account Service. Inténtalo de nuevo.');
    }
    if (response.status === 404) throw new NotFoundException('Cuenta de origen no encontrada.');
    if (!response.ok) throw new ServiceUnavailableException(`Account Service respondió ${response.status}.`);
    return response.json() as Promise<AccountInfo>;
  }

  /** Crea u obtiene la cuenta de comercio del convenio (idempotente por código). */
  async ensureMerchantAccount(code: string, name: string, currency: string): Promise<MerchantAccount> {
    const baseUrl = this.config.get<string>('ACCOUNT_SERVICE_URL', 'http://localhost:3002');
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/internal/accounts/merchants`, {
        method: 'POST',
        headers: this.internalHeaders(),
        body: JSON.stringify({ code, name, currency }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new ServiceUnavailableException('No se pudo contactar Account Service.');
    }
    if (!response.ok) throw new ServiceUnavailableException(`Account Service respondió ${response.status}.`);
    return response.json() as Promise<MerchantAccount>;
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
    const baseUrl = this.config.get<string>('LEDGER_SERVICE_URL', 'http://localhost:3006');
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/ledger/internal/payments`, {
        method: 'POST',
        headers: this.internalHeaders(),
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new ServiceUnavailableException('No se pudo contactar Ledger Service. Puedes reintentar la confirmación.');
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = Array.isArray(payload?.message)
        ? payload.message.join(', ')
        : payload?.message || 'Ledger Service rechazó el pago.';
      if (response.status >= 500) throw new BadGatewayException(message);
      throw new HttpException(message, response.status);
    }
    return payload;
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
    const baseUrl = this.config.get<string>('LEDGER_SERVICE_URL', 'http://localhost:3006');
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/ledger/internal/rewards`, {
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
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new ServiceUnavailableException('No se pudo contactar Ledger Service.');
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = Array.isArray(payload?.message)
        ? payload.message.join(', ')
        : payload?.message || 'Ledger Service rechazó el pago.';
      if (response.status >= 500) throw new BadGatewayException(message);
      throw new HttpException(message, response.status);
    }
    return payload;
  }

  /** Valida la clave dinámica con Auth Service. */
  async verifyDynamicKey(userId: string, code: string): Promise<void> {
    const baseUrl = this.config.get<string>('AUTH_SERVICE_URL', 'http://localhost:3001');
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/internal/dynamic-key/verify`, {
        method: 'POST',
        headers: this.internalHeaders(),
        body: JSON.stringify({ idUser: userId, code }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new ServiceUnavailableException('No se pudo validar la clave dinámica. Inténtalo de nuevo.');
    }

    const payload = await response.json().catch(() => ({}));
    if (response.status === 403 && /clave dinámica/i.test(payload?.message || '')) {
      throw new ForbiddenException(payload.message);
    }
    if (!response.ok)
      throw new ServiceUnavailableException('No se pudo validar la clave dinámica. Inténtalo de nuevo.');
    if (payload?.valid !== true) {
      throw new BadRequestException(payload?.message || 'Clave dinámica incorrecta o vencida.');
    }
  }

  private internalHeaders() {
    const key = this.config.get<string>('INTERNAL_API_KEY');
    if (!key) throw new ServiceUnavailableException('INTERNAL_API_KEY no está configurada en Payment Service.');
    return { 'Content-Type': 'application/json', 'x-internal-key': key };
  }
}
