import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Factura inscrita por el cliente para consultarla y pagarla con un toque cada mes. */
@Entity('saved_bills')
@Index('uq_saved_bills_user_bill', ['userId', 'billerCode', 'reference'], { unique: true })
export class SavedBill {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'biller_code', type: 'varchar', length: 40 })
  billerCode: string;

  @Column({ type: 'varchar', length: 20 })
  reference: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
