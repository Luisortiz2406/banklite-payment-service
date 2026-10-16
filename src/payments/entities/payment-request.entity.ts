import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { BillerKind } from '../catalog';

export type PaymentStatus = 'pending' | 'processing' | 'completed' | 'cancelled';

/**
 * Solicitud de pago de factura o de recarga. Igual que en transfer-service:
 * se prepara, se confirma con la clave dinámica y solo entonces se mueve el
 * dinero en el ledger (idempotente por idempotencyKey).
 */
@Entity('payment_requests')
@Index('idx_payment_requests_user_created', ['userId', 'createdAt'])
// Una factura (convenio + referencia + periodo) se paga una sola vez, aunque la
// intenten pagar dos personas a la vez: el segundo 'processing' choca aquí.
@Index('uq_payment_requests_bill', ['billerCode', 'reference', 'period'], {
  unique: true,
  where: "kind = 'bill' AND status IN ('processing', 'completed')",
})
export class PaymentRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 6 })
  kind: BillerKind;

  @Column({ name: 'biller_code', type: 'varchar', length: 40 })
  billerCode: string;

  // Referencia de la factura o número de celular de la recarga.
  @Column({ type: 'varchar', length: 20 })
  reference: string;

  // Solo facturas: mes facturado (YYYY-MM) y fecha de vencimiento.
  @Column({ type: 'varchar', length: 7, nullable: true })
  period: string | null;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate: string | null;

  // Solo recargas: saldo, datos, minutos o todo incluido.
  @Column({ name: 'topup_type', type: 'varchar', length: 30, nullable: true })
  topupType: string | null;

  @Column({ name: 'source_account_id', type: 'uuid' })
  sourceAccountId: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  amount: string;

  @Column({ type: 'varchar', length: 3, default: 'COP' })
  currency: string;

  @Column({ type: 'varchar', length: 140 })
  description: string;

  @Index({ unique: true })
  @Column({ name: 'idempotency_key', type: 'uuid' })
  idempotencyKey: string;

  @Column({ type: 'varchar', length: 12, default: 'pending' })
  status: PaymentStatus;

  @Column({ name: 'ledger_transaction_id', type: 'uuid', nullable: true })
  ledgerTransactionId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
