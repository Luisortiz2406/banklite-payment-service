import { BILLER_CATALOG, currentDescription } from './catalog';

describe('catálogo de convenios', () => {
  it('no usa marcas reales', () => {
    const brands = /claro|movistar|tigo|wom|virgin|epm|enel|vanti|etb|directv|emcali|acueducto|celsia|afinia|air-e/i;
    expect(BILLER_CATALOG.filter((item) => brands.test(item.name)).map((item) => item.name)).toEqual([]);
  });

  it('los códigos no cambian (los usan las facturas inscritas y las cuentas de comercio)', () => {
    const codes = BILLER_CATALOG.map((item) => item.code);
    expect(codes).toEqual(expect.arrayContaining(['fac-acueducto', 'fac-claro-hogar', 'fac-tel-wom', 'rec-claro']));
    expect(new Set(codes).size).toBe(codes.length);
  });

  describe('currentDescription', () => {
    it('traduce los nombres antiguos de facturas, recargas y canjes', () => {
      expect(currentDescription('Agua · Acueducto de Bogotá · Ref. 12345678')).toBe(
        'Agua · Aguas Demo Sabana · Ref. 12345678',
      );
      expect(currentDescription('Acueducto de Bogotá · Ref. 12345678')).toBe('Aguas Demo Sabana · Ref. 12345678');
      expect(currentDescription('Internet · Claro Hogar · Ref. 998877')).toBe(
        'Internet · Internet Demo Colibrí · Ref. 998877',
      );
      expect(currentDescription('Claro · Paquete de datos · 3001234567')).toBe(
        'Móvil Demo Colibrí · Paquete de datos · 3001234567',
      );
      expect(currentDescription('Tigo · Canje de Puntos Banklite · 3001234567')).toBe(
        'Móvil Demo Guacamaya · Canje de Puntos Banklite · 3001234567',
      );
    });

    it('no toca la nota del cliente en un pago QR ni las descripciones nuevas', () => {
      expect(currentDescription('Pago QR · Café La Esquina · Claro')).toBe('Pago QR · Café La Esquina · Claro');
      expect(currentDescription('Agua · Aguas Demo Sabana · Ref. 1')).toBe('Agua · Aguas Demo Sabana · Ref. 1');
    });
  });
});
