import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DYNAMIC_KEY, ANA, CARLOS, createPaymentsFixture } from '../testing/payments-fixture';
import { describeWithDb, truncateAll } from '../testing/test-database';
import { MAX_SAVED_BILLS } from './catalog';

/**
 * Consultas, QR, facturas inscritas, cancelación y errores del ledger de
 * PaymentsService (PostgreSQL real; ledger, account y auth simulados). Lo más
 * importante: saldo insuficiente, límites e idempotencia nunca dejan un pago a
 * medias ni cobran dos veces.
 */
const BILL = 'fac-acueducto';
const OPERATOR = 'rec-claro';
const CAFE = 'qr-cafe-la-esquina'; // valor fijo: $8.500
const TIENDA = 'qr-tienda-don-pepe'; // el cliente escribe el valor
const QR_ACCOUNT = '90000000001';

describeWithDb('PaymentsService: operaciones y errores', () => {
  let fx: Awaited<ReturnType<typeof createPaymentsFixture>>;
  let anaAccount: string;
  let carlosAccount: string;

  beforeAll(async () => {
    fx = await createPaymentsFixture();
  });
  afterAll(() => fx?.drop());

  beforeEach(async () => {
    await truncateAll(fx.dataSource);
    jest.restoreAllMocks();
    jest.clearAllMocks();
    anaAccount = randomUUID();
    carlosAccount = randomUUID();
    for (const key of Object.keys(fx.accounts)) delete fx.accounts[key];
    fx.accounts[anaAccount] = { idUser: ANA, status: 'active' };
    fx.accounts[carlosAccount] = { idUser: CARLOS, status: 'active' };
    for (const code of [BILL, OPERATOR, CAFE, TIENDA]) await fx.addBiller(code, { accountNumber: QR_ACCOUNT });
  });

  const prepare = (overrides: Record<string, unknown> = {}, userId = ANA) =>
    fx.payments.prepare(
      {
        kind: 'topup',
        billerCode: OPERATOR,
        reference: '3001234567',
        sourceAccountId: anaAccount,
        amount: 10_000,
        idempotencyKey: randomUUID(),
        ...overrides,
      } as never,
      userId,
    );
  const prepareBill = (reference = '12345678', overrides: Record<string, unknown> = {}) =>
    prepare({ kind: 'bill', billerCode: BILL, reference, amount: undefined, ...overrides });
  const prepareQr = (billerCode = CAFE, overrides: Record<string, unknown> = {}) =>
    prepare({ kind: 'qr', billerCode, reference: QR_ACCOUNT, amount: undefined, ...overrides });
  const statusOf = async (id: string) => (await fx.requests.findOneByOrFail({ id })).status;

  describe('catálogo y consultas', () => {
    it('el catálogo marca como no disponibles los convenios sin cuenta de comercio y trae los topes de recarga', async () => {
      await fx.billerRepo.update(BILL, { accountId: null });

      const catalog = await fx.payments.catalog();

      expect(catalog.billers.find((b) => b.code === BILL)?.available).toBe(false);
      expect(catalog.billers.find((b) => b.code === OPERATOR)?.available).toBe(true);
      expect(catalog.billers.some((b) => b.kind === 'qr')).toBe(false);
      expect(catalog.services.length).toBeGreaterThan(0);
      expect(catalog.topup).toMatchObject({ min: 1_000, max: 500_000 });
    });

    it('los comercios QR traen su número de cuenta, su valor fijo y si están disponibles', async () => {
      await fx.billerRepo.update(TIENDA, { accountId: null });

      const stores = await fx.payments.qrStores();

      expect(stores.find((s) => s.code === CAFE)).toMatchObject({
        accountNumber: QR_ACCOUNT,
        amount: 8_500,
        available: true,
      });
      expect(stores.find((s) => s.code === TIENDA)).toMatchObject({ amount: 0, available: false });
      expect(stores.every((s) => s.code.startsWith('qr-'))).toBe(true);
    });

    it('consultar una factura: pendiente, luego pagada, e inscrita si el cliente la guardó', async () => {
      const before = await fx.payments.lookupBill(BILL, '12 345 678', ANA);
      expect(before).toMatchObject({ billerCode: BILL, reference: '12345678', status: 'pending', saved: false });
      expect(before.amount).toBeGreaterThan(0);
      expect(typeof before.overdue).toBe('boolean');
      expect(before.paidAt).toBeNull();

      await fx.payments.saveBill(ANA, BILL, '12345678');
      const request = await prepareBill();
      await fx.payments.confirm(request.id, ANA, DYNAMIC_KEY);

      const after = await fx.payments.lookupBill(BILL, '12345678', ANA);
      expect(after).toMatchObject({ status: 'paid', saved: true });
      expect(after.paidAt).toBeInstanceOf(Date);
      // Otro cliente ve la misma factura pagada, pero no inscrita.
      expect(await fx.payments.lookupBill(BILL, '12345678', CARLOS)).toMatchObject({ status: 'paid', saved: false });
    });

    it('una factura en proceso se muestra como "processing"', async () => {
      const request = await prepareBill();
      await fx.requests.update(request.id, { status: 'processing' });
      expect(await fx.payments.lookupBill(BILL, '12345678', ANA)).toMatchObject({ status: 'processing', paidAt: null });
    });

    it('rechaza una empresa que no existe, un operador usado como factura y una referencia mal formada', async () => {
      await expect(fx.payments.lookupBill('fac-no-existe', '12345678', ANA)).rejects.toBeInstanceOf(NotFoundException);
      await expect(fx.payments.lookupBill(OPERATOR, '12345678', ANA)).rejects.toBeInstanceOf(NotFoundException);
      await expect(fx.payments.lookupBill(BILL, '123', ANA)).rejects.toThrow('entre 6 y 14 números');
      await expect(fx.payments.lookupBill(BILL, '12345678901234567', ANA)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('el historial trae solo lo completado, lo más reciente primero', async () => {
      const first = await prepare();
      const second = await prepare({ reference: '3109876543' });
      await prepare({ reference: '3201112233' }); // queda pendiente
      await fx.payments.confirm(first.id, ANA, DYNAMIC_KEY);
      await fx.payments.confirm(second.id, ANA, DYNAMIC_KEY);

      const history = await fx.payments.list(ANA);

      expect(history.map((h) => h.reference)).toEqual(['3109876543', '3001234567']);
      expect(history[0]).toMatchObject({ status: 'completed', billerAccountLast4: '0001' });
      expect(await fx.payments.list(CARLOS)).toEqual([]);
    });
  });

  describe('pagos con QR', () => {
    it('con valor fijo cobra el del comercio aunque el cliente mande otro', async () => {
      const request = await prepareQr(CAFE, { amount: 1_000 });

      expect(request).toMatchObject({ kind: 'qr', amount: 8_500, status: 'pending' });
      expect(request.description).toBe('Pago QR · Café La Esquina · Café y pandebono');
      const paid = await fx.payments.confirm(request.id, ANA, DYNAMIC_KEY);
      expect(paid.status).toBe('completed');
      expect(fx.banking.pay).toHaveBeenCalledWith(expect.objectContaining({ amount: 8_500 }));
    });

    it('con valor libre exige pesos enteros entre $1.000 y $5.000.000', async () => {
      for (const amount of [999, 5_000_001, 2_500.5, undefined]) {
        await expect(prepareQr(TIENDA, { amount })).rejects.toThrow('pesos enteros');
      }
      const ok = await prepareQr(TIENDA, { amount: 25_000, note: ' Mercado ' });
      expect(ok).toMatchObject({ amount: 25_000 });
      expect(ok.description).toBe('Pago QR · Tienda Don Pepe · Mercado');
      expect((await prepareQr(TIENDA, { amount: 3_000 })).description).toBe(
        'Pago QR · Tienda Don Pepe · Compra en Tienda Don Pepe',
      );
    });

    it('el código QR debe ser del comercio: otro número de cuenta se rechaza', async () => {
      await expect(prepareQr(CAFE, { reference: '90000000099' })).rejects.toThrow('no corresponde a ese comercio');
      expect(await fx.requests.count()).toBe(0);
    });
  });

  describe('preparar: validaciones', () => {
    it('un convenio sin cuenta de comercio todavía no recibe pagos (503) y no crea solicitud', async () => {
      await fx.billerRepo.update(OPERATOR, { accountId: null });
      await expect(prepare()).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(await fx.requests.count()).toBe(0);
    });

    it('rechaza un convenio que no existe o de otro tipo', async () => {
      await expect(prepare({ billerCode: 'rec-no-existe' })).rejects.toBeInstanceOf(NotFoundException);
      await expect(prepare({ kind: 'bill', billerCode: OPERATOR, reference: '12345678' })).rejects.toThrow(
        'Esa empresa no está disponible',
      );
      await expect(prepare({ kind: 'qr', billerCode: BILL, reference: QR_ACCOUNT })).rejects.toThrow(
        'Ese comercio no está disponible',
      );
    });

    it('el celular debe tener 10 dígitos y empezar por 3', async () => {
      for (const reference of ['2001234567', '300123456', '30012345678']) {
        await expect(prepare({ reference })).rejects.toThrow('celular de 10 dígitos');
      }
      await expect(prepare({ reference: '300 123 4567' })).resolves.toMatchObject({ reference: '3001234567' });
    });

    it('la cuenta de origen debe ser del cliente, activa, de persona y en la moneda del convenio', async () => {
      await expect(prepare({ sourceAccountId: carlosAccount })).rejects.toBeInstanceOf(ForbiddenException);
      fx.accounts[anaAccount] = { idUser: ANA, status: 'active', accountType: 'merchant' };
      await expect(prepare()).rejects.toBeInstanceOf(ForbiddenException);
      fx.accounts[anaAccount] = { idUser: ANA, status: 'blocked' };
      await expect(prepare()).rejects.toThrow('Tu cuenta no está activa');
      fx.accounts[anaAccount] = { idUser: ANA, status: 'active', currency: 'USD' };
      await expect(prepare()).rejects.toThrow('misma moneda');
      expect(await fx.requests.count()).toBe(0);
    });

    it('la misma clave con los mismos datos devuelve la misma solicitud; con otros datos es un conflicto', async () => {
      const key = randomUUID();
      const first = await prepare({ idempotencyKey: key });
      const again = await prepare({ idempotencyKey: key });

      expect(again.id).toBe(first.id);
      expect(await fx.requests.count()).toBe(1);
      for (const change of [{ amount: 20_000 }, { reference: '3109999999' }, { billerCode: 'rec-movistar' }]) {
        await expect(prepare({ idempotencyKey: key, ...change })).rejects.toBeInstanceOf(ConflictException);
      }
      await expect(prepare({ idempotencyKey: key }, CARLOS)).rejects.toBeInstanceOf(ConflictException);
    });

    it('si otra petición con la misma clave gana la carrera al guardar, devuelve esa solicitud', async () => {
      const key = randomUUID();
      const winner = await prepare({ idempotencyKey: key });
      // La primera búsqueda no la ve (todavía no estaba guardada); al guardar choca con la clave única.
      jest.spyOn(fx.requests, 'findOne').mockResolvedValueOnce(null);

      const result = await prepare({ idempotencyKey: key });

      expect(result.id).toBe(winner.id);
      expect(await fx.requests.count()).toBe(1);
    });
  });

  describe('confirmar: errores y saldo', () => {
    it('saldo insuficiente: el pago no se hace, la solicitud vuelve a pendiente y el reintento usa la misma clave', async () => {
      const request = await prepare();
      fx.banking.pay.mockRejectedValueOnce(new BadRequestException('Saldo insuficiente.'));

      await expect(fx.payments.confirm(request.id, ANA, DYNAMIC_KEY)).rejects.toThrow('Saldo insuficiente');
      expect(await statusOf(request.id)).toBe('pending');
      expect((await fx.requests.findOneByOrFail({ id: request.id })).ledgerTransactionId).toBeNull();

      const retried = await fx.payments.confirm(request.id, ANA, DYNAMIC_KEY);
      expect(retried.status).toBe('completed');
      const keys = fx.banking.pay.mock.calls.map((call) => (call[0] as { idempotencyKey: string }).idempotencyKey);
      expect(new Set(keys).size).toBe(1);
      expect(fx.banking.pay).toHaveBeenCalledTimes(2);
    });

    it('un límite diario superado (403 del ledger) también deja la solicitud pendiente', async () => {
      const request = await prepare();
      fx.banking.pay.mockRejectedValueOnce(
        new ForbiddenException('La operación supera el límite diario de la cuenta.'),
      );

      await expect(fx.payments.confirm(request.id, ANA, DYNAMIC_KEY)).rejects.toBeInstanceOf(ForbiddenException);
      expect(await statusOf(request.id)).toBe('pending');
    });

    it('envía al ledger el valor, la cuenta de origen, la cuenta del convenio y la clave de idempotencia', async () => {
      const request = await prepare();
      const biller = await fx.billerRepo.findOneByOrFail({ code: OPERATOR });

      const paid = await fx.payments.confirm(request.id, ANA, DYNAMIC_KEY);

      expect(fx.banking.pay).toHaveBeenCalledWith({
        sourceAccountId: anaAccount,
        merchantAccountId: biller.accountId,
        amount: 10_000,
        idempotencyKey: (await fx.requests.findOneByOrFail({ id: request.id })).idempotencyKey,
        description: expect.stringContaining('3001234567'),
      });
      expect(paid.ledgerTransactionId).toEqual(expect.any(String));
    });

    it('una solicitud que no existe o es de otro cliente da 404; una cancelada da 409', async () => {
      const request = await prepare();
      await expect(fx.payments.confirm(randomUUID(), ANA, DYNAMIC_KEY)).rejects.toBeInstanceOf(NotFoundException);
      await expect(fx.payments.confirm(request.id, CARLOS, DYNAMIC_KEY)).rejects.toBeInstanceOf(NotFoundException);

      await fx.payments.cancel(request.id, ANA);
      await expect(fx.payments.confirm(request.id, ANA, DYNAMIC_KEY)).rejects.toThrow('fue cancelada');
      expect(fx.banking.pay).not.toHaveBeenCalled();
    });

    it('si el convenio perdió su cuenta de comercio no se mueve dinero', async () => {
      const request = await prepare();
      await fx.billerRepo.update(OPERATOR, { accountId: null });

      await expect(fx.payments.confirm(request.id, ANA, DYNAMIC_KEY)).rejects.toThrow('todavía no está disponible');
      expect(fx.banking.pay).not.toHaveBeenCalled();
      expect(await statusOf(request.id)).toBe('pending');
    });

    it('una confirmación en curso da 409; una abandonada hace más de 60 s se reclama y se completa', async () => {
      const table = fx.requests.metadata.tableName;
      const request = await prepare();

      await fx.dataSource.query(`UPDATE ${table} SET status = 'processing', updated_at = now() WHERE id = $1`, [
        request.id,
      ]);
      await expect(fx.payments.confirm(request.id, ANA, DYNAMIC_KEY)).rejects.toThrow('ya está siendo procesada');
      expect(fx.banking.pay).not.toHaveBeenCalled();

      await fx.dataSource.query(
        `UPDATE ${table} SET status = 'processing', updated_at = now() - interval '2 minutes' WHERE id = $1`,
        [request.id],
      );
      await expect(fx.payments.confirm(request.id, ANA, DYNAMIC_KEY)).resolves.toMatchObject({ status: 'completed' });
      expect(fx.banking.pay).toHaveBeenCalledTimes(1);
    });
  });

  describe('cancelar', () => {
    it('cancela una pendiente y cancelar otra vez devuelve lo mismo', async () => {
      const request = await prepare();

      expect(await fx.payments.cancel(request.id, ANA)).toMatchObject({ status: 'cancelled' });
      expect(await fx.payments.cancel(request.id, ANA)).toMatchObject({ status: 'cancelled' });
    });

    it('no cancela un pago completado ni en proceso, ni el de otro cliente', async () => {
      const done = await prepare();
      await fx.payments.confirm(done.id, ANA, DYNAMIC_KEY);
      await expect(fx.payments.cancel(done.id, ANA)).rejects.toThrow('Solo se pueden cancelar solicitudes pendientes');

      const running = await prepare({ reference: '3109876543' });
      await fx.requests.update(running.id, { status: 'processing' });
      await expect(fx.payments.cancel(running.id, ANA)).rejects.toBeInstanceOf(ConflictException);

      const other = await prepare({ reference: '3201112233' });
      await expect(fx.payments.cancel(other.id, CARLOS)).rejects.toBeInstanceOf(NotFoundException);
      await expect(fx.payments.cancel(randomUUID(), ANA)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('si la solicitud pasa a procesándose justo al cancelar, no se cancela', async () => {
      const request = await prepare();
      const spy = jest.spyOn(fx.requests, 'update').mockResolvedValueOnce({ affected: 0 } as never);

      await expect(fx.payments.cancel(request.id, ANA)).rejects.toThrow('ya está siendo procesada');
      spy.mockRestore();
      expect(await statusOf(request.id)).toBe('pending');
    });
  });

  describe('facturas inscritas', () => {
    it('inscribe sin repetir, lista lo más reciente primero y marca las pagadas este mes', async () => {
      await fx.payments.saveBill(ANA, BILL, '11111111');
      await fx.payments.saveBill(ANA, BILL, '11111111');
      const saved = await fx.payments.saveBill(ANA, BILL, '22222222');

      expect(saved.map((s) => s.reference)).toEqual(['22222222', '11111111']);
      expect(saved[0]).toMatchObject({ billerName: expect.any(String), paidThisMonth: false });

      const request = await prepareBill('11111111');
      await fx.payments.confirm(request.id, ANA, DYNAMIC_KEY);
      const after = await fx.payments.listSavedBills(ANA);
      expect(after.find((s) => s.reference === '11111111')?.paidThisMonth).toBe(true);
      expect(after.find((s) => s.reference === '22222222')?.paidThisMonth).toBe(false);
      expect(await fx.payments.listSavedBills(CARLOS)).toEqual([]);
    });

    it('no pasa del máximo de facturas inscritas', async () => {
      for (let i = 0; i < MAX_SAVED_BILLS; i++) await fx.payments.saveBill(ANA, BILL, String(100000 + i));

      await expect(fx.payments.saveBill(ANA, BILL, '999999')).rejects.toThrow(`hasta ${MAX_SAVED_BILLS} facturas`);
      // Inscribir una que ya está no cuenta contra el máximo.
      await expect(fx.payments.saveBill(ANA, BILL, '100000')).resolves.toHaveLength(MAX_SAVED_BILLS);
    });

    it('un doble clic (clave duplicada) no falla, y un error distinto sí se propaga', async () => {
      const duplicated = Object.assign(new Error('duplicate key'), { code: '23505' });
      jest.spyOn(fx.savedBills, 'save').mockRejectedValueOnce(duplicated);
      await expect(fx.payments.saveBill(ANA, BILL, '11111111')).resolves.toEqual([]);

      jest.spyOn(fx.savedBills, 'save').mockRejectedValueOnce(new Error('base caída'));
      await expect(fx.payments.saveBill(ANA, BILL, '11111111')).rejects.toThrow('base caída');
    });

    it('valida la empresa y la referencia, y solo el dueño borra una inscrita', async () => {
      await expect(fx.payments.saveBill(ANA, 'fac-no-existe', '12345678')).rejects.toBeInstanceOf(NotFoundException);
      await expect(fx.payments.saveBill(ANA, BILL, '12')).rejects.toBeInstanceOf(BadRequestException);

      const [mine] = await fx.payments.saveBill(ANA, BILL, '12345678');
      await expect(fx.payments.deleteSavedBill(CARLOS, mine.id)).rejects.toBeInstanceOf(NotFoundException);
      expect(await fx.payments.deleteSavedBill(ANA, mine.id)).toEqual([]);
      await expect(fx.payments.deleteSavedBill(ANA, mine.id)).rejects.toThrow('Factura inscrita no encontrada');
    });
  });

  describe('recargas de canjes (rewardTopup): validaciones', () => {
    const topup = (overrides: Record<string, unknown> = {}) =>
      fx.payments.rewardTopup({
        beneficiaryUserId: ANA,
        billerCode: OPERATOR,
        phone: '3001234567',
        amount: 10_000,
        idempotencyKey: randomUUID(),
        ...overrides,
      } as never);

    it('solo paga a operadores de recarga que tengan cuenta de comercio', async () => {
      await expect(topup({ billerCode: BILL })).rejects.toThrow('Ese operador no está disponible');
      await fx.billerRepo.update(OPERATOR, { accountId: null });
      await expect(topup()).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(fx.banking.payFromRewards).not.toHaveBeenCalled();
      expect(await fx.requests.count()).toBe(0);
    });

    it('queda registrada como recarga del cliente, pagada desde la cuenta Recompensas', async () => {
      const result = await topup({ amount: 15_000 });

      expect(result).toMatchObject({ kind: 'topup', amount: 15_000, status: 'completed', reference: '3001234567' });
      expect(result.sourceAccountId).toBe('00000000-0000-4000-8000-000000000007');
      expect(result.description).toContain('Canje de Puntos Banklite');
      expect(await fx.payments.list(ANA)).toHaveLength(1);
    });

    it('la misma clave para otro cliente o para otro celular es un conflicto', async () => {
      const key = randomUUID();
      await topup({ idempotencyKey: key });
      await expect(topup({ idempotencyKey: key, beneficiaryUserId: CARLOS })).rejects.toBeInstanceOf(ConflictException);
      await expect(topup({ idempotencyKey: key, phone: '3109999999' })).rejects.toBeInstanceOf(ConflictException);
      expect(fx.banking.payFromRewards).toHaveBeenCalledTimes(1);
    });

    it('si dos peticiones con la misma clave chocan al guardar, la perdedora ve el estado de la ganadora', async () => {
      const key = randomUUID();
      await topup({ idempotencyKey: key });
      jest.spyOn(fx.requests, 'findOne').mockResolvedValueOnce(null);

      const again = await topup({ idempotencyKey: key });

      expect(again.status).toBe('completed');
      expect(fx.banking.payFromRewards).toHaveBeenCalledTimes(1);
    });
  });
});
