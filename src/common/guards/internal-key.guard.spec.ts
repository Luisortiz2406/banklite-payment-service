import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalKeyGuard } from './internal-key.guard';

// Prueba el guard común de las rutas internas (idéntico en todos los servicios): cada
// servicio que llama tiene su propia clave y sin clave configurada se rechaza todo.

const TRANSFER_KEY = 'clave-de-transfer-para-pruebas-012345678';
const CARD_KEY = 'clave-de-card-para-pruebas-0123456789012';

function contextFor(key?: string | string[]) {
  const request: { headers: Record<string, string | string[]>; internalCaller?: string } = {
    headers: key === undefined ? {} : { 'x-internal-key': key },
  };
  const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
  return { context, request };
}
const guard = (trusted?: string) => new InternalKeyGuard(new ConfigService({ INTERNAL_TRUSTED_KEYS: trusted }));
const both = `transfer:${TRANSFER_KEY},card:${CARD_KEY}`;

describe('InternalKeyGuard', () => {
  it('acepta la clave de un servicio de confianza y deja anotado quién llama', () => {
    const transfer = contextFor(TRANSFER_KEY);
    expect(guard(both).canActivate(transfer.context)).toBe(true);
    expect(transfer.request.internalCaller).toBe('transfer');

    const card = contextFor(CARD_KEY);
    guard(both).canActivate(card.context);
    expect(card.request.internalCaller).toBe('card');
  });

  it('sin clave, con una clave vacía, repetida o desconocida da 401', () => {
    for (const key of [
      undefined,
      '',
      [TRANSFER_KEY, CARD_KEY],
      'clave-desconocida-0123456789012345678',
      TRANSFER_KEY + 'x',
    ]) {
      expect(() => guard(both).canActivate(contextFor(key).context)).toThrow(UnauthorizedException);
    }
  });

  it('sin INTERNAL_TRUSTED_KEYS se rechaza todo (falla cerrado)', () => {
    expect(() => guard(undefined).canActivate(contextFor(TRANSFER_KEY).context)).toThrow('Clave interna requerida');
    expect(() => guard('').canActivate(contextFor(TRANSFER_KEY).context)).toThrow(UnauthorizedException);
  });

  it('una configuración mal escrita impide crear el guard', () => {
    expect(() => guard('sin-formato')).toThrow('INTERNAL_TRUSTED_KEYS');
    expect(() => guard('transfer:corta')).toThrow('al menos 32');
  });
});
