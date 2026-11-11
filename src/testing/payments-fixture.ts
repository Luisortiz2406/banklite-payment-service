import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { BankingClientService } from '../payments/banking-client.service';
import { BillersService } from '../payments/billers.service';
import { catalogItem } from '../payments/catalog';
import { Biller } from '../payments/entities/biller.entity';
import { PaymentRequest } from '../payments/entities/payment-request.entity';
import { SavedBill } from '../payments/entities/saved-bill.entity';
import { PaymentsService } from '../payments/payments.service';
import { createTestDatabase } from './test-database';

/**
 * PaymentsService real sobre una base PostgreSQL temporal. El ledger, account-service
 * y auth-service se simulan (el código de la clave dinámica es DYNAMIC_KEY).
 */

export const ANA = '11111111-1111-4111-8111-111111111111';
export const CARLOS = '22222222-2222-4222-8222-222222222222';
export const DYNAMIC_KEY = '123456';

export type AccountRecord = { idUser: string; status: string; accountType?: string; currency?: string };

export async function createPaymentsFixture() {
  const { dataSource, drop } = await createTestDatabase('payment', [PaymentRequest, SavedBill, Biller]);
  const requests = dataSource.getRepository(PaymentRequest);
  const savedBills = dataSource.getRepository(SavedBill);
  const billerRepo = dataSource.getRepository(Biller);
  const accounts: Record<string, AccountRecord> = {};

  const banking = {
    getAccount: jest.fn(async (id: string) => ({
      id,
      accountNumber: '10000000001',
      accountType: 'savings',
      currency: 'COP',
      ...accounts[id],
    })),
    verifyDynamicKey: jest.fn(async (_userId: string, code: string) => {
      if (code !== DYNAMIC_KEY) throw new BadRequestException('Clave dinámica incorrecta o vencida.');
    }),
    pay: jest.fn(async (_params: unknown) => ({ id: randomUUID() }) as { id?: string }),
    payFromRewards: jest.fn(async (_params: unknown) => ({ id: randomUUID() }) as { id?: string }),
  };
  const billers = {
    findByCode: (code: string) => billerRepo.findOne({ where: { code } }),
    findAll: () => billerRepo.find(),
  } as unknown as BillersService;
  const payments = new PaymentsService(requests, savedBills, billers, banking as unknown as BankingClientService);

  /** Crea la cuenta del convenio (con o sin cuenta de comercio asignada). */
  const addBiller = (code: string, overrides: Partial<Biller> = {}) =>
    billerRepo.save({
      code,
      name: catalogItem(code)!.name,
      currency: 'COP',
      accountId: randomUUID(),
      accountNumber: '90000000001',
      ...overrides,
    });

  return { dataSource, drop, requests, savedBills, billerRepo, accounts, banking, payments, addBiller };
}
