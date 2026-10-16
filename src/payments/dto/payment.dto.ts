import { IsIn, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { TOPUP_TYPES } from '../catalog';

const BILLER_CODE = /^[a-z0-9-]{2,40}$/;

/** GET /payments/bills?billerCode=&reference= — consulta de la factura del mes. */
export class BillQueryDto {
  @Matches(BILLER_CODE, { message: 'billerCode no es válido.' })
  billerCode: string;

  @IsString()
  @MaxLength(30)
  reference: string;
}

export class PreparePaymentDto {
  @IsIn(['bill', 'topup', 'qr'])
  kind: 'bill' | 'topup' | 'qr';

  @IsUUID()
  sourceAccountId: string;

  @Matches(BILLER_CODE, { message: 'billerCode no es válido.' })
  billerCode: string;

  // Referencia de la factura o número de celular.
  @IsString()
  @MaxLength(30)
  reference: string;

  // Solo recargas. En facturas el valor lo fija el convenio, nunca el cliente.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(999_999_999_999.99)
  amount?: number;

  // Solo QR: concepto que escribe quien paga.
  @IsOptional()
  @IsString()
  @MaxLength(60)
  note?: string;

  // Solo recargas.
  @IsOptional()
  @IsIn(TOPUP_TYPES as unknown as string[], { message: 'Tipo de recarga no válido.' })
  topupType?: string;

  @IsUUID()
  idempotencyKey: string;
}

/** POST /payments/saved-bills — inscribe una factura. */
export class SaveBillDto {
  @Matches(BILLER_CODE, { message: 'billerCode no es válido.' })
  billerCode: string;

  @IsString()
  @MaxLength(30)
  reference: string;
}

/** POST /internal/payments/reward-topups — recarga de un canje de Puntos Banklite (rewards-service). */
export class RewardTopupDto {
  @IsUUID()
  beneficiaryUserId: string;

  @Matches(BILLER_CODE, { message: 'billerCode no es válido.' })
  billerCode: string;

  // Celular verificado del cliente.
  @Matches(/^3\d{9}$/, { message: 'El celular debe tener 10 dígitos y empezar por 3.' })
  phone: string;

  @IsNumber({ maxDecimalPlaces: 0 })
  @Min(1000)
  @Max(500000)
  amount: number;

  @IsUUID()
  idempotencyKey: string;
}

export class ConfirmPaymentDto {
  // Clave dinámica de 6 dígitos (cambia cada 60 s). La valida Auth Service.
  @Matches(/^\d{6}$/, { message: 'Ingresa tu clave dinámica de 6 dígitos.' })
  dynamicCode: string;
}
