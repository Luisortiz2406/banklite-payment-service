import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BankingClientService } from './banking-client.service';
import { BILLER_CATALOG } from './catalog';
import { Biller } from './entities/biller.entity';

const RETRY_MS = 30_000;

/**
 * Al arrancar, sincroniza el catálogo en la tabla billers y se asegura de que
 * cada convenio tenga su cuenta de comercio en account-service. Si
 * account-service no está listo, reintenta cada 30 s sin bloquear el arranque.
 */
@Injectable()
export class BillersService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Billers');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(Biller) private readonly billers: Repository<Biller>,
    private readonly banking: BankingClientService,
  ) {}

  async onApplicationBootstrap() {
    await this.billers.upsert(
      BILLER_CATALOG.map((item) => ({ code: item.code, name: item.name, currency: 'COP' })),
      ['code'],
    );
    void this.ensureAccounts();
  }

  onModuleDestroy() {
    if (this.timer) clearTimeout(this.timer);
  }

  /** Crea las cuentas que falten; true cuando todos los convenios tienen cuenta. */
  async ensureAccounts(): Promise<boolean> {
    const missing = (await this.billers.find()).filter((biller) => !biller.accountId);
    for (const biller of missing) {
      try {
        const account = await this.banking.ensureMerchantAccount(biller.code, biller.name, biller.currency);
        await this.billers.update(biller.code, { accountId: account.id, accountNumber: account.accountNumber });
      } catch (error) {
        this.logger.warn(
          `Cuenta del convenio ${biller.code} pendiente: ${(error as Error).message}. Reintento en 30 s.`,
        );
        this.timer = setTimeout(() => void this.ensureAccounts(), RETRY_MS);
        return false;
      }
    }
    if (missing.length) this.logger.log(`Cuentas de convenios listas (${missing.length} nuevas).`);
    return true;
  }

  async findAll() {
    return this.billers.find();
  }

  async findByCode(code: string) {
    return this.billers.findOne({ where: { code } });
  }
}
