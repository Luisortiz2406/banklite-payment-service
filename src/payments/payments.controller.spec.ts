import { InternalKeyGuard } from '../common/guards/internal-key.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { paymentsCatalog } from './catalog';
import { PaymentsCatalogController } from './payments-catalog.controller';
import { InternalPaymentsController, PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

describe('PaymentsController', () => {
  const service = {
    catalog: jest.fn().mockResolvedValue({ billers: [] }),
    lookupBill: jest.fn().mockResolvedValue({ status: 'pending' }),
    qrStores: jest.fn().mockResolvedValue([]),
    listSavedBills: jest.fn().mockResolvedValue([]),
    saveBill: jest.fn().mockResolvedValue(['s1']),
    deleteSavedBill: jest.fn().mockResolvedValue([]),
    list: jest.fn().mockResolvedValue(['p1']),
    prepare: jest.fn().mockResolvedValue({ id: 'req-1' }),
    confirm: jest.fn().mockResolvedValue({ status: 'completed' }),
    cancel: jest.fn().mockResolvedValue({ status: 'cancelled' }),
    rewardTopup: jest.fn().mockResolvedValue({ status: 'completed' }),
  };
  const controller = new PaymentsController(service as unknown as PaymentsService);
  const request = { user: { idUser: 'user-1' } } as never;

  it('todas las rutas del cliente exigen sesión; las internas, clave interna; el catálogo de topes es público', () => {
    expect(Reflect.getMetadata('__guards__', PaymentsController)).toContain(JwtAuthGuard);
    expect(Reflect.getMetadata('__guards__', InternalPaymentsController)).toContain(InternalKeyGuard);
    expect(Reflect.getMetadata('__guards__', PaymentsCatalogController)).toBeUndefined();
    expect(new PaymentsCatalogController().catalog()).toEqual(paymentsCatalog());
  });

  it('cada ruta pasa al servicio el cliente de la sesión, nunca uno que venga en el cuerpo', async () => {
    await controller.catalog();
    await controller.qrStores();
    await controller.lookupBill({ billerCode: 'fac-acueducto', reference: '12345678' }, request);
    expect(service.lookupBill).toHaveBeenCalledWith('fac-acueducto', '12345678', 'user-1');

    await controller.savedBills(request);
    expect(service.listSavedBills).toHaveBeenCalledWith('user-1');
    await controller.saveBill({ billerCode: 'fac-acueducto', reference: '12345678' }, request);
    expect(service.saveBill).toHaveBeenCalledWith('user-1', 'fac-acueducto', '12345678');
    await controller.deleteSavedBill('id-1', request);
    expect(service.deleteSavedBill).toHaveBeenCalledWith('user-1', 'id-1');

    expect(await controller.list(request)).toEqual(['p1']);
    expect(service.list).toHaveBeenCalledWith('user-1');
    const dto = { kind: 'topup' } as never;
    await controller.prepare(dto, request);
    expect(service.prepare).toHaveBeenCalledWith(dto, 'user-1');
    await controller.confirm('req-1', { dynamicCode: '123456' } as never, request);
    expect(service.confirm).toHaveBeenCalledWith('req-1', 'user-1', '123456');
    await controller.cancel('req-1', request);
    expect(service.cancel).toHaveBeenCalledWith('req-1', 'user-1');
  });

  it('la recarga de un canje (red interna) pasa el cuerpo tal cual', async () => {
    const dto = { beneficiaryUserId: 'u1', billerCode: 'rec-claro', phone: '3001234567', amount: 10_000 } as never;
    await new InternalPaymentsController(service as unknown as PaymentsService).rewardTopup(dto);
    expect(service.rewardTopup).toHaveBeenCalledWith(dto);
  });
});
