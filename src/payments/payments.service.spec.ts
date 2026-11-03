import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { createTestDatabase, describeWithDb, truncateAll } from '../testing/test-database';
import { BankingClientService } from './banking-client.service';
import { BillersService } from './billers.service';
import { payService, catalogItem } from './catalog';
import { simulatedBill } from './bills';
import { Biller } from './entities/biller.entity';
import { PaymentRequest } from './entities/payment-request.entity';
import { SavedBill } from './entities/saved-bill.entity';
import { PaymentsService } from './payments.service';

/**
 * Reglas de pagos contra PostgreSQL real: "una factura se paga una sola vez por
 * periodo" la garantiza un índice único parcial, que solo existe en la base.
 * El ledger, account-service y auth-service se simulan.
 */
const ANA = '11111111-1111-4111-8111-111111111111';
const CARLOS = '22222222-2222-4222-8222-222222222222';
const DYNAMIC_KEY = '123456';
const BILLER = 'fac-acueducto';
const OPERATOR = 'rec-claro';

describeWithDb('PaymentsService (PostgreSQL)', () => {
  let dataSource: DataSource;
  let drop: () => Promise<void>;
  let requests: Repository<PaymentRequest>;
  let payments: PaymentsService;
  let accounts: Record<string, { idUser: string; status: string }>;
  let anaAccount: string;
  let carlosAccount: string;

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
    pay: jest.fn(async () => ({ id: randomUUID() })),
    payFromRewards: jest.fn(async () => ({ id: randomUUID() })),
  };

  beforeAll(async () => {
    ({ dataSource, drop } = await createTestDatabase('payment', [PaymentRequest, SavedBill, Biller]));
    requests = dataSource.getRepository(PaymentRequest);
    const billerRepo = dataSource.getRepository(Biller);
    const billers = {
      findByCode: (code: string) => billerRepo.findOne({ where: { code } }),
      findAll: () => billerRepo.find(),
    } as unknown as BillersService;
    payments = new PaymentsService(
      requests,
      dataSource.getRepository(SavedBill),
      billers,
      banking as unknown as BankingClientService,
    );
  });

  afterAll(() => drop?.());

  beforeEach(async () => {
    await truncateAll(dataSource);
    jest.clearAllMocks();
    anaAccount = randomUUID();
    carlosAccount = randomUUID();
    accounts = {
      [anaAccount]: { idUser: ANA, status: 'active' },
      [carlosAccount]: { idUser: CARLOS, status: 'active' },
    };
    const billerRepo = dataSource.getRepository(Biller);
    for (const code of [BILLER, OPERATOR]) {
      await billerRepo.save({
        code,
        name: catalogItem(code)!.name,
        currency: 'COP',
        accountId: randomUUID(),
        accountNumber: '90000000001',
      });
    }
  });

  const prepareBill = (userId = ANA, sourceAccountId = anaAccount, reference = '12345678', amount?: number) =>
    payments.prepare(
      { kind: 'bill', billerCode: BILLER, reference, sourceAccountId, amount, idempotencyKey: randomUUID() },
      userId,
    );

  describe('facturas', () => {
    it('el valor lo fija la factura, no el cliente', async () => {
      const prepared = await prepareBill(ANA, anaAccount, '12345678', 1);
      const expected = simulatedBill(BILLER, payService(catalogItem(BILLER)!.service!), '12345678');
      expect(Number(prepared.amount)).toBe(expected.amount);
    });

    it('una factura se paga una sola vez por periodo', async () => {
      const first = await prepareBill();
      await payments.confirm(first.id, ANA, DYNAMIC_KEY);

      await expect(prepareBill()).rejects.toThrow('Esta factura ya está pagada este mes.');
      // Tampoco la paga otra persona con otra cuenta.
      await expect(prepareBill(CARLOS, carlosAccount)).rejects.toBeInstanceOf(ConflictException);
      expect(banking.pay).toHaveBeenCalledTimes(1);
    });

    it('dos pagos simultáneos de la misma factura: solo uno mueve dinero', async () => {
      const [a, b] = await Promise.all([prepareBill(ANA, anaAccount), prepareBill(CARLOS, carlosAccount)]);
      const results = await Promise.allSettled([
        payments.confirm(a.id, ANA, DYNAMIC_KEY),
        payments.confirm(b.id, CARLOS, DYNAMIC_KEY),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: expect.any(ConflictException) });
      expect(banking.pay).toHaveBeenCalledTimes(1);
      expect(await requests.countBy({ status: 'completed' })).toBe(1);
    });

    it('otra referencia u otra empresa sí se pueden pagar', async () => {
      await payments.confirm((await prepareBill()).id, ANA, DYNAMIC_KEY);
      await expect(prepareBill(ANA, anaAccount, '87654321')).resolves.toBeDefined();
    });

    it('una solicitud cancelada no bloquea la factura', async () => {
      const first = await prepareBill();
      await payments.cancel(first.id, ANA);
      const second = await prepareBill();
      await expect(payments.confirm(second.id, ANA, DYNAMIC_KEY)).resolves.toMatchObject({ status: 'completed' });
      await expect(payments.confirm(first.id, ANA, DYNAMIC_KEY)).rejects.toThrow('La solicitud fue cancelada.');
    });

    it('confirmar dos veces devuelve el mismo pago sin cobrar de nuevo', async () => {
      const prepared = await prepareBill();
      await payments.confirm(prepared.id, ANA, DYNAMIC_KEY);
      await expect(payments.confirm(prepared.id, ANA, DYNAMIC_KEY)).resolves.toMatchObject({ status: 'completed' });
      expect(banking.pay).toHaveBeenCalledTimes(1);
    });
  });

  describe('nombres antiguos (marcas reales)', () => {
    it('una solicitud preparada antes del cambio se muestra y llega al ledger con el nombre nuevo', async () => {
      const prepared = await prepareBill();
      await requests.update(prepared.id, { description: 'Agua · Acueducto de Bogotá · Ref. 12345678' });

      const paid = await payments.confirm(prepared.id, ANA, DYNAMIC_KEY);
      expect(paid.description).toBe('Agua · Aguas Demo Sabana · Ref. 12345678');
      expect(paid.billerName).toBe('Aguas Demo Sabana');
      expect(banking.pay).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Agua · Aguas Demo Sabana · Ref. 12345678' }),
      );
      // La base no se reescribe.
      expect((await requests.findOneBy({ id: prepared.id }))!.description).toContain('Acueducto de Bogotá');
    });
  });

  describe('confirmación', () => {
    it('sin clave dinámica válida no se mueve dinero', async () => {
      const prepared = await prepareBill();
      await expect(payments.confirm(prepared.id, ANA, '000000')).rejects.toBeInstanceOf(BadRequestException);
      expect(banking.pay).not.toHaveBeenCalled();
      expect((await requests.findOneBy({ id: prepared.id }))!.status).toBe('pending');
    });

    it('si el ledger falla, la solicitud vuelve a pendiente y el reintento usa la misma clave', async () => {
      const prepared = await prepareBill();
      banking.pay.mockRejectedValueOnce(new ServiceUnavailableException('Ledger caído'));
      await expect(payments.confirm(prepared.id, ANA, DYNAMIC_KEY)).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect((await requests.findOneBy({ id: prepared.id }))!.status).toBe('pending');

      await payments.confirm(prepared.id, ANA, DYNAMIC_KEY);
      const keys = banking.pay.mock.calls.map(
        (call: unknown[]) => (call[0] as { idempotencyKey: string }).idempotencyKey,
      );
      expect(keys).toHaveLength(2);
      expect(new Set(keys).size).toBe(1);
    });

    it('no se paga desde una cuenta ajena ni desde una cuenta inactiva', async () => {
      await expect(prepareBill(CARLOS, anaAccount)).rejects.toBeInstanceOf(ForbiddenException);
      accounts[anaAccount].status = 'blocked';
      await expect(prepareBill()).rejects.toThrow('Tu cuenta no está activa');
    });
  });

  describe('recargas', () => {
    const prepareTopup = (amount: number) =>
      payments.prepare(
        {
          kind: 'topup',
          billerCode: OPERATOR,
          reference: '3001234567',
          sourceAccountId: anaAccount,
          amount,
          idempotencyKey: randomUUID(),
        },
        ANA,
      );

    it('respeta el mínimo y el máximo y exige pesos enteros', async () => {
      await expect(prepareTopup(999)).rejects.toBeInstanceOf(BadRequestException);
      await expect(prepareTopup(500_001)).rejects.toBeInstanceOf(BadRequestException);
      await expect(prepareTopup(1_500.5)).rejects.toBeInstanceOf(BadRequestException);
      await expect(prepareTopup(1_000)).resolves.toMatchObject({ status: 'pending' });
    });
  });

  describe('recargas pagadas con puntos (rewardTopup)', () => {
    const topup = (idempotencyKey: string) =>
      payments.rewardTopup({
        beneficiaryUserId: ANA,
        billerCode: OPERATOR,
        phone: '3001234567',
        amount: 10_000,
        idempotencyKey,
      });
    const statusOf = async (idempotencyKey: string) => (await requests.findOneBy({ idempotencyKey }))?.status;

    it('con la misma clave nunca se paga dos veces', async () => {
      const key = randomUUID();
      await topup(key);
      await topup(key);
      expect(banking.payFromRewards).toHaveBeenCalledTimes(1);
      expect(await statusOf(key)).toBe('completed');
    });

    it('si el ledger la rechaza (4xx) queda cancelada y no se vuelve a pagar', async () => {
      const key = randomUUID();
      banking.payFromRewards.mockRejectedValueOnce(new BadRequestException('Saldo insuficiente.'));
      await expect(topup(key)).rejects.toBeInstanceOf(BadRequestException);
      expect(await statusOf(key)).toBe('cancelled');

      // rewards-service ya devolvió los puntos: un reintento no puede pagarla.
      await expect(topup(key)).rejects.toBeInstanceOf(ConflictException);
      expect(banking.payFromRewards).toHaveBeenCalledTimes(1);
    });

    it('si la falla es incierta (5xx o red) no la cancela: queda en proceso y el reintento la completa', async () => {
      const key = randomUUID();
      banking.payFromRewards.mockRejectedValueOnce(new ServiceUnavailableException('Ledger no responde'));
      await expect(topup(key)).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(await statusOf(key)).toBe('processing');

      await expect(topup(key)).resolves.toMatchObject({ status: 'completed' });
      const keys = banking.payFromRewards.mock.calls.map(
        (call: unknown[]) => (call[0] as { idempotencyKey: string }).idempotencyKey,
      );
      expect(keys).toEqual([key, key]);
    });

    it('un error de red (sin respuesta HTTP) tampoco la cancela', async () => {
      const key = randomUUID();
      banking.payFromRewards.mockRejectedValueOnce(new Error('ECONNRESET'));
      await expect(topup(key)).rejects.toThrow('ECONNRESET');
      expect(await statusOf(key)).toBe('processing');
    });

    it('la misma clave con otro monto es un conflicto', async () => {
      const key = randomUUID();
      await topup(key);
      await expect(
        payments.rewardTopup({
          beneficiaryUserId: ANA,
          billerCode: OPERATOR,
          phone: '3001234567',
          amount: 20_000,
          idempotencyKey: key,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
