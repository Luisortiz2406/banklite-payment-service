import { Repository } from 'typeorm';
import { BankingClientService } from './banking-client.service';
import { BillersService } from './billers.service';
import { BILLER_CATALOG } from './catalog';
import { Biller } from './entities/biller.entity';

/** Al arrancar, sincroniza el catálogo y crea la cuenta de comercio de cada convenio (reintenta si account no está listo). */
describe('BillersService', () => {
  const biller = (code: string, accountId: string | null = null) =>
    ({ code, name: `Convenio ${code}`, currency: 'COP', accountId, accountNumber: null }) as Biller;
  const setup = (rows: Biller[]) => {
    const repo = {
      upsert: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockImplementation(async () => rows),
      update: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn().mockResolvedValue(rows[0]),
    };
    const banking = {
      ensureMerchantAccount: jest.fn().mockImplementation(async (code: string) => ({
        id: `cuenta-${code}`,
        accountNumber: '90000000001',
      })),
    };
    const service = new BillersService(
      repo as unknown as Repository<Biller>,
      banking as unknown as BankingClientService,
    );
    return { service, repo, banking };
  };

  afterEach(() => jest.useRealTimers());

  it('al arrancar sincroniza todo el catálogo por código y pide las cuentas que faltan', async () => {
    const { service, repo } = setup([]);
    jest.spyOn(service, 'ensureAccounts').mockResolvedValue(true);

    await service.onApplicationBootstrap();

    const [rows, conflict] = repo.upsert.mock.calls[0];
    expect(conflict).toEqual(['code']);
    expect(rows).toHaveLength(BILLER_CATALOG.length);
    expect(rows[0]).toMatchObject({ code: BILLER_CATALOG[0].code, currency: 'COP' });
    expect(service.ensureAccounts).toHaveBeenCalledTimes(1);
  });

  it('crea la cuenta solo de los convenios que no la tienen y la guarda con su número', async () => {
    const { service, repo, banking } = setup([biller('fac-uno', 'ya-tiene'), biller('fac-dos'), biller('fac-tres')]);

    expect(await service.ensureAccounts()).toBe(true);

    expect(banking.ensureMerchantAccount).toHaveBeenCalledTimes(2);
    expect(banking.ensureMerchantAccount).toHaveBeenCalledWith('fac-dos', 'Convenio fac-dos', 'COP');
    expect(repo.update).toHaveBeenCalledWith('fac-dos', { accountId: 'cuenta-fac-dos', accountNumber: '90000000001' });
    expect(repo.update).toHaveBeenCalledWith('fac-tres', {
      accountId: 'cuenta-fac-tres',
      accountNumber: '90000000001',
    });
  });

  it('si account-service no está listo, para y reintenta en 30 s sin bloquear el arranque', async () => {
    jest.useFakeTimers();
    const { service, banking } = setup([biller('fac-uno'), biller('fac-dos')]);
    banking.ensureMerchantAccount.mockRejectedValueOnce(new Error('Account Service no disponible'));

    expect(await service.ensureAccounts()).toBe(false);
    expect(banking.ensureMerchantAccount).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(30_000);
    expect(banking.ensureMerchantAccount).toHaveBeenCalledTimes(3); // reintento: ambos convenios
  });

  it('cerrar el módulo cancela el reintento pendiente', async () => {
    jest.useFakeTimers();
    const { service, banking } = setup([biller('fac-uno')]);
    banking.ensureMerchantAccount.mockRejectedValue(new Error('caído'));
    await service.ensureAccounts();

    service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(120_000);

    expect(banking.ensureMerchantAccount).toHaveBeenCalledTimes(1);
  });

  it('findAll y findByCode leen de la tabla', async () => {
    const { service, repo } = setup([biller('fac-uno')]);

    expect(await service.findAll()).toHaveLength(1);
    expect(await service.findByCode('fac-uno')).toMatchObject({ code: 'fac-uno' });
    expect(repo.findOne).toHaveBeenCalledWith({ where: { code: 'fac-uno' } });
  });
});
