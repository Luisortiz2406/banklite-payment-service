import { BadRequestException, HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BankingClientService } from './banking-client.service';

/**
 * Llamadas de payment-service a account, ledger y auth (fetch simulado). Lo que
 * importa: un rechazo de negocio del ledger (saldo, límite) llega al cliente con su
 * estado y mensaje, y una falla del otro servicio nunca se confunde con un éxito.
 */

const KEY = 'clave-interna-de-payment-para-pruebas-0123';
const reply = (status: number, body: unknown = {}) =>
  Promise.resolve({ status, ok: status >= 200 && status < 300, json: async () => body } as unknown as Response);

describe('BankingClientService', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  const build = (env: Record<string, string> = {}) =>
    new BankingClientService(new ConfigService({ INTERNAL_API_KEY: KEY, ...env }));
  const failure = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return error as HttpException;
    }
    throw new Error('no lanzó excepción');
  };

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as never;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  const payment = {
    sourceAccountId: 'a1',
    merchantAccountId: 'm1',
    amount: 25_000,
    idempotencyKey: 'k1',
    description: 'Pago de factura',
  };

  describe('getAccount (account-service)', () => {
    it('devuelve la cuenta y arma la URL con la base sin barras finales y el id codificado', async () => {
      const info = { id: 'a/1', idUser: 'u1', accountNumber: '10000000001', accountType: 'savings', currency: 'COP' };
      fetchMock.mockReturnValue(reply(200, info));

      expect(await build({ ACCOUNT_SERVICE_URL: 'http://account.interno:3002//' }).getAccount('a/1')).toEqual(info);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://account.interno:3002/internal/accounts/a%2F1/ledger-info');
      expect(init.headers['x-internal-key']).toBe(KEY);
    });

    it('una cuenta inexistente es 404 con el mensaje de payment; la lectura reintenta una vez ante 503', async () => {
      fetchMock.mockReturnValueOnce(reply(404, {}));
      const error = await failure(build().getAccount('x'));
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe('Cuenta de origen no encontrada.');

      fetchMock
        .mockReset()
        .mockReturnValueOnce(reply(503))
        .mockReturnValueOnce(reply(200, { id: 'a1' }));
      await expect(build().getAccount('a1')).resolves.toEqual({ id: 'a1' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('ensureMerchantAccount (account-service)', () => {
    it('crea u obtiene la cuenta del convenio mandando su código, nombre y moneda', async () => {
      fetchMock.mockReturnValue(reply(200, { id: 'm1', accountNumber: '90000000001', currency: 'COP' }));

      const account = await build().ensureMerchantAccount('fac-acueducto', 'Acueducto Montecielo', 'COP');

      expect(account.id).toBe('m1');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://localhost:3002/internal/accounts/merchants');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ code: 'fac-acueducto', name: 'Acueducto Montecielo', currency: 'COP' });
    });

    it('si account-service falla es 503 (billers lo reintenta más tarde)', async () => {
      fetchMock.mockReturnValue(reply(500, { message: 'boom' }));
      expect(await failure(build().ensureMerchantAccount('c', 'n', 'COP'))).toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('pay (ledger)', () => {
    it('manda el pago con la clave interna y la clave de idempotencia, y devuelve la transacción', async () => {
      fetchMock.mockReturnValue(reply(201, { id: 'tx-1' }));

      expect(await build({ LEDGER_SERVICE_URL: 'http://ledger.interno:3006/' }).pay(payment)).toEqual({ id: 'tx-1' });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://ledger.interno:3006/ledger/internal/payments');
      expect(init.headers['x-internal-key']).toBe(KEY);
      expect(JSON.parse(init.body)).toEqual(payment);
    });

    it('saldo insuficiente o límite diario llegan con su estado y mensaje', async () => {
      fetchMock.mockReturnValueOnce(reply(400, { message: 'Saldo insuficiente.' }));
      const insufficient = await failure(build().pay(payment));
      expect(insufficient.getStatus()).toBe(400);
      expect(insufficient.message).toBe('Saldo insuficiente.');

      fetchMock.mockReturnValueOnce(reply(403, { message: 'La operación supera el límite diario de la cuenta.' }));
      const limit = await failure(build().pay(payment));
      expect(limit.getStatus()).toBe(403);
    });

    it('si el ledger falla o rechaza nuestra clave interna es 503, y el pago no se reintenta solo', async () => {
      fetchMock.mockReturnValue(reply(500, { message: 'boom' }));
      const error = await failure(build().pay(payment));
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(error.message).toContain('Puedes reintentar la confirmación');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      fetchMock.mockReset().mockReturnValue(reply(401, { message: 'Clave interna inválida' }));
      expect(await failure(build().pay(payment))).toBeInstanceOf(ServiceUnavailableException);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('payFromRewards (ledger)', () => {
    const rewards = {
      merchantAccountId: 'm1',
      beneficiaryUserId: 'u1',
      amount: 10_000,
      idempotencyKey: 'k2',
      description: 'Canje',
    };

    it('paga a un comercio desde Recompensas en nombre del cliente', async () => {
      fetchMock.mockReturnValue(reply(201, { id: 'tx-2' }));

      expect(await build().payFromRewards(rewards)).toEqual({ id: 'tx-2' });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://localhost:3006/ledger/internal/rewards');
      expect(JSON.parse(init.body)).toEqual({
        target: 'merchant',
        accountId: 'm1',
        beneficiaryUserId: 'u1',
        amount: 10_000,
        idempotencyKey: 'k2',
        description: 'Canje',
      });
    });

    it('un rechazo del ledger conserva su estado (es lo que decide si se cancela la recarga)', async () => {
      fetchMock.mockReturnValue(reply(400, { message: 'La cuenta destino no es de un comercio.' }));
      expect((await failure(build().payFromRewards(rewards))).getStatus()).toBe(400);
    });
  });

  describe('verifyDynamicKey (auth-service)', () => {
    it('con una clave válida resuelve y manda el usuario y el código', async () => {
      fetchMock.mockReturnValue(reply(200, { valid: true }));

      await expect(build().verifyDynamicKey('u1', '123456')).resolves.toBeUndefined();

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://localhost:3001/internal/dynamic-key/verify');
      expect(JSON.parse(init.body)).toEqual({ idUser: 'u1', code: '123456' });
    });

    it('una clave incorrecta es 400 con el mensaje de auth o uno por defecto', async () => {
      fetchMock.mockReturnValueOnce(reply(200, { valid: false, message: 'La clave dinámica venció.' }));
      const withMessage = await failure(build().verifyDynamicKey('u1', '000000'));
      expect(withMessage).toBeInstanceOf(BadRequestException);
      expect(withMessage.message).toBe('La clave dinámica venció.');

      fetchMock.mockReturnValueOnce(reply(200, {}));
      expect((await failure(build().verifyDynamicKey('u1', '000000'))).message).toBe(
        'Clave dinámica incorrecta o vencida.',
      );
    });

    it('si auth no responde es 503: no se confirma nada', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const error = await failure(build().verifyDynamicKey('u1', '123456'));
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(error.message).toBe('No se pudo validar la clave dinámica. Inténtalo de nuevo.');
    });
  });

  it('sin INTERNAL_API_KEY ninguna llamada sale', async () => {
    const service = new BankingClientService(new ConfigService({}));
    for (const call of [
      () => service.getAccount('a1'),
      () => service.pay(payment),
      () => service.verifyDynamicKey('u1', '1'),
    ]) {
      const error = await failure(call());
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(error.message).toContain('INTERNAL_API_KEY no está configurada en Payment Service');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
