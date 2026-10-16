import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Cuenta de comercio de cada convenio / operador del catálogo. payment-service
 * la crea (o la obtiene) en account-service al arrancar; mientras account_id
 * sea nulo, ese convenio no acepta pagos.
 */
@Entity('billers')
export class Biller {
  @PrimaryColumn({ type: 'varchar', length: 40 })
  code: string;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 3, default: 'COP' })
  currency: string;

  @Column({ name: 'account_id', type: 'uuid', nullable: true })
  accountId: string | null;

  @Column({ name: 'account_number', type: 'varchar', length: 11, nullable: true })
  accountNumber: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
