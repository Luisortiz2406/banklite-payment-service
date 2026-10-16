import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { validateEnv } from './config/env.validation';
import { HealthController } from './health.controller';
import { Biller } from './payments/entities/biller.entity';
import { PaymentRequest } from './payments/entities/payment-request.entity';
import { SavedBill } from './payments/entities/saved-bill.entity';
import { PaymentsModule } from './payments/payments.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: validateEnv(
        [
          { key: 'JWT_SECRET', type: 'secret' },
          { key: 'INTERNAL_API_KEY', type: 'secret' },
          // Quién puede pedir recargas de canjes de puntos: "rewards:<clave>".
          { key: 'INTERNAL_TRUSTED_KEYS', type: 'trusted-keys', optional: true },
          { key: 'DATABASE_URL', type: 'url' },
        ],
        ['JWT_SECRET', 'INTERNAL_API_KEY'],
      ),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.get<string>('DATABASE_URL'),
        entities: [PaymentRequest, Biller, SavedBill],
        synchronize: true,
        logging: false,
      }),
    }),
    PaymentsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
