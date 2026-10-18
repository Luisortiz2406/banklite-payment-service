import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InternalKeyGuard } from '../common/guards/internal-key.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { BankingClientService } from './banking-client.service';
import { BillersService } from './billers.service';
import { Biller } from './entities/biller.entity';
import { PaymentRequest } from './entities/payment-request.entity';
import { SavedBill } from './entities/saved-bill.entity';
import { PaymentsCatalogController } from './payments-catalog.controller';
import { InternalPaymentsController, PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [ConfigModule, JwtModule.register({}), TypeOrmModule.forFeature([PaymentRequest, Biller, SavedBill])],
  controllers: [PaymentsCatalogController, PaymentsController, InternalPaymentsController],
  providers: [PaymentsService, BillersService, BankingClientService, JwtAuthGuard, InternalKeyGuard],
})
export class PaymentsModule {}
