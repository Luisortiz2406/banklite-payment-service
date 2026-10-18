import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { InternalKeyGuard } from '../common/guards/internal-key.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { BillQueryDto, ConfirmPaymentDto, PreparePaymentDto, RewardTopupDto, SaveBillDto } from './dto/payment.dto';
import { PaymentsService } from './payments.service';

const userOf = (request: Request): string => (request as any).user.idUser;

/** Pago de facturas y recargas de celular del cliente. */
@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('billers')
  catalog() {
    return this.payments.catalog();
  }

  @Get('bills')
  lookupBill(@Query() query: BillQueryDto, @Req() request: Request) {
    return this.payments.lookupBill(query.billerCode, query.reference, userOf(request));
  }

  @Get('qr/stores')
  qrStores() {
    return this.payments.qrStores();
  }

  @Get('saved-bills')
  savedBills(@Req() request: Request) {
    return this.payments.listSavedBills(userOf(request));
  }

  @Post('saved-bills')
  @HttpCode(HttpStatus.OK)
  saveBill(@Body() dto: SaveBillDto, @Req() request: Request) {
    return this.payments.saveBill(userOf(request), dto.billerCode, dto.reference);
  }

  @Delete('saved-bills/:id')
  deleteSavedBill(@Param('id', ParseUUIDPipe) id: string, @Req() request: Request) {
    return this.payments.deleteSavedBill(userOf(request), id);
  }

  @Get()
  list(@Req() request: Request) {
    return this.payments.list(userOf(request));
  }

  @Post('prepare')
  prepare(@Body() dto: PreparePaymentDto, @Req() request: Request) {
    return this.payments.prepare(dto, userOf(request));
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  confirm(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmPaymentDto, @Req() request: Request) {
    return this.payments.confirm(id, userOf(request), dto.dynamicCode);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Req() request: Request) {
    return this.payments.cancel(id, userOf(request));
  }
}

/** Solo red interna (el gateway no publica /internal): recargas de canjes de puntos. */
@Controller('internal/payments')
@UseGuards(InternalKeyGuard)
export class InternalPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('reward-topups')
  @HttpCode(HttpStatus.OK)
  rewardTopup(@Body() dto: RewardTopupDto) {
    return this.payments.rewardTopup(dto);
  }
}
