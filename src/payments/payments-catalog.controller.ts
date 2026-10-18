import { Controller, Get } from '@nestjs/common';
import { paymentsCatalog } from './catalog';

/** Topes de recargas, públicos (sin sesión): los usan Banki y el frontend. */
@Controller('payments')
export class PaymentsCatalogController {
  @Get('catalog')
  catalog() {
    return paymentsCatalog();
  }
}
