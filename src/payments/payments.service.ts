import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BankingClientService } from './banking-client.service';
import { BillersService } from './billers.service';
import { bogotaToday, simulatedBill } from './bills';
import {
  BILL_REFERENCE,
  BILLER_CATALOG,
  BillerKind,
  CatalogItem,
  catalogItem,
  MAX_SAVED_BILLS,
  normalizeReference,
  PAY_SERVICES,
  payService,
  PHONE,
  QR_MAX,
  QR_MIN,
  TOPUP_MAX,
  TOPUP_MIN,
  TOPUP_TYPES,
} from './catalog';
import { PreparePaymentDto, RewardTopupDto } from './dto/payment.dto';
import { Biller } from './entities/biller.entity';
import { PaymentRequest } from './entities/payment-request.entity';
import { SavedBill } from './entities/saved-bill.entity';

// Igual que en transfer-service: una confirmación que lleva más de esto en
// 'processing' se considera abandonada y puede reintentarse. Es seguro porque
// el ledger es idempotente por idempotencyKey.
const STALE_PROCESSING_MS = 60_000;

// Cuenta de sistema "Recompensas" del ledger (COP): origen de las recargas que el
// banco paga cuando alguien canjea Puntos Banklite.
const REWARDS_ACCOUNT_COP = '00000000-0000-4000-8000-000000000007';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(PaymentRequest) private readonly requests: Repository<PaymentRequest>,
    @InjectRepository(SavedBill) private readonly savedBills: Repository<SavedBill>,
    private readonly billers: BillersService,
    private readonly banking: BankingClientService,
  ) {}

  // =====================================================
  // CONSULTAS
  // =====================================================

  async catalog() {
    const accounts = await this.billerMap();
    return {
      services: PAY_SERVICES.map(({ key, name }) => ({ key, name })),
      billers: BILLER_CATALOG.filter((item) => item.kind !== 'qr').map((item) => ({
        code: item.code,
        name: item.name,
        kind: item.kind,
        service: item.service,
        available: !!accounts.get(item.code)?.accountId,
      })),
      topup: { min: TOPUP_MIN, max: TOPUP_MAX, types: TOPUP_TYPES },
    };
  }

  /** Factura del mes para una referencia (simulada; ver bills.ts) y si ya está pagada. */
  async lookupBill(billerCode: string, rawReference: string, userId: string) {
    const item = this.requireItem(billerCode, 'bill');
    const reference = this.validReference(item, rawReference);
    const bill = simulatedBill(item.code, payService(item.service), reference);
    const paid = await this.takenBy(item.code, reference, bill.period);
    const saved = await this.savedBills.exist({ where: { userId, billerCode: item.code, reference } });
    return {
      billerCode: item.code,
      billerName: item.name,
      service: item.service,
      serviceName: payService(item.service).name,
      reference,
      period: bill.period,
      billedPeriod: bill.billedPeriod,
      amount: bill.amount,
      currency: 'COP',
      dueDate: bill.dueDate,
      overdue: bill.dueDate < bogotaToday(),
      status: paid ? (paid.status === 'completed' ? 'paid' : 'processing') : 'pending',
      paidAt: paid?.status === 'completed' ? paid.updatedAt : null,
      saved,
    };
  }

  /**
   * Comercios de prueba para pagar con QR. Su QR lleva el número de su cuenta de
   * comercio: la app reconoce ese número y paga por aquí (el ledger no acepta
   * transferencias a cuentas de comercio).
   */
  async qrStores() {
    const accounts = await this.billerMap();
    return BILLER_CATALOG.filter((item) => item.kind === 'qr').map((item) => ({
      code: item.code,
      name: item.name,
      accountNumber: accounts.get(item.code)?.accountNumber ?? null,
      amount: item.qrAmount ?? 0,
      note: item.qrNote ?? '',
      available: !!accounts.get(item.code)?.accountId,
    }));
  }

  /** Pagos y recargas completados del cliente, del más reciente al más antiguo. */
  async list(userId: string) {
    const [requests, accounts] = await Promise.all([
      this.requests.find({ where: { userId, status: 'completed' }, order: { createdAt: 'DESC' }, take: 30 }),
      this.billerMap(),
    ]);
    return requests.map((request) => this.publicRequest(request, accounts.get(request.billerCode)));
  }

  // =====================================================
  // FACTURAS INSCRITAS
  // =====================================================

  async listSavedBills(userId: string) {
    const rows = await this.savedBills.find({ where: { userId }, order: { createdAt: 'DESC' } });
    const period = bogotaToday().slice(0, 7);
    const paid = rows.length
      ? await this.requests.find({
          where: { kind: 'bill', period, status: 'completed', billerCode: In(rows.map((r) => r.billerCode)) },
          select: { billerCode: true, reference: true },
        })
      : [];
    const paidKeys = new Set(paid.map((p) => `${p.billerCode}|${p.reference}`));
    return rows.map((row) => {
      const item = catalogItem(row.billerCode);
      return {
        id: row.id,
        billerCode: row.billerCode,
        billerName: item?.name ?? row.billerCode,
        service: item?.service ?? null,
        serviceName: payService(item?.service ?? null)?.name ?? 'Servicio',
        reference: row.reference,
        paidThisMonth: paidKeys.has(`${row.billerCode}|${row.reference}`),
        createdAt: row.createdAt,
      };
    });
  }

  async saveBill(userId: string, billerCode: string, rawReference: string) {
    const item = this.requireItem(billerCode, 'bill');
    const reference = this.validReference(item, rawReference);
    const existing = await this.savedBills.findOne({ where: { userId, billerCode: item.code, reference } });
    if (!existing) {
      if ((await this.savedBills.count({ where: { userId } })) >= MAX_SAVED_BILLS) {
        throw new BadRequestException(`Puedes inscribir hasta ${MAX_SAVED_BILLS} facturas.`);
      }
      try {
        await this.savedBills.save(this.savedBills.create({ userId, billerCode: item.code, reference }));
      } catch (error) {
        if ((error as any)?.code !== '23505') throw error; // ya inscrita (doble clic)
      }
    }
    return this.listSavedBills(userId);
  }

  async deleteSavedBill(userId: string, id: string) {
    const result = await this.savedBills.delete({ id, userId });
    if (!result.affected) throw new NotFoundException('Factura inscrita no encontrada.');
    return this.listSavedBills(userId);
  }

  // =====================================================
  // PREPARAR → CONFIRMAR / CANCELAR
  // =====================================================

  async prepare(dto: PreparePaymentDto, userId: string) {
    const existing = await this.requests.findOne({ where: { idempotencyKey: dto.idempotencyKey } });
    if (existing) {
      this.assertSameRequest(existing, dto, userId);
      return this.publicRequest(existing);
    }

    const item = this.requireItem(dto.billerCode, dto.kind);
    const biller = await this.billers.findByCode(item.code);
    if (!biller?.accountId) {
      throw new ServiceUnavailableException(`${item.name} todavía no está disponible. Inténtalo en unos minutos.`);
    }
    // En QR la referencia es el número de cuenta del comercio que traía el código.
    const reference =
      item.kind === 'qr' ? this.qrReference(biller, dto.reference) : this.validReference(item, dto.reference);

    // La cuenta de origen debe ser del usuario de la sesión (el ledger interno no lo valida).
    const account = await this.banking.getAccount(dto.sourceAccountId);
    if (account.idUser !== userId || account.accountType === 'merchant') {
      throw new ForbiddenException('La cuenta de origen no te pertenece.');
    }
    if (account.status !== 'active')
      throw new BadRequestException('Tu cuenta no está activa, por eso no puedes pagar.');
    if (account.currency !== biller.currency)
      throw new BadRequestException('La cuenta y el convenio deben usar la misma moneda.');

    let fields: Pick<PaymentRequest, 'amount' | 'period' | 'dueDate' | 'topupType' | 'description'>;
    if (item.kind === 'bill') {
      // El valor lo fija la factura: se ignora cualquier monto que mande el cliente.
      const service = payService(item.service);
      const bill = simulatedBill(item.code, service, reference);
      if (await this.takenBy(item.code, reference, bill.period)) {
        throw new ConflictException('Esta factura ya está pagada este mes.');
      }
      fields = {
        amount: bill.amount.toFixed(2),
        period: bill.period,
        dueDate: bill.dueDate,
        topupType: null,
        description: `${service.name} · ${item.name} · Ref. ${reference}`,
      };
    } else if (item.kind === 'qr') {
      // Si el comercio fija el valor, manda ese; si no, lo escribe quien paga.
      const amount = item.qrAmount ? item.qrAmount : Number(dto.amount);
      if (!Number.isInteger(amount) || amount < QR_MIN || amount > QR_MAX) {
        throw new BadRequestException('El valor debe ser de $1.000 a $5.000.000, en pesos enteros.');
      }
      const note = dto.note?.trim() || item.qrNote || `Compra en ${item.name}`;
      fields = {
        amount: amount.toFixed(2),
        period: null,
        dueDate: null,
        topupType: null,
        description: `Pago QR · ${item.name} · ${note}`.slice(0, 140),
      };
    } else {
      const amount = Number(dto.amount);
      if (!Number.isInteger(amount) || amount < TOPUP_MIN || amount > TOPUP_MAX) {
        throw new BadRequestException('La recarga debe ser de $1.000 a $500.000, en pesos enteros.');
      }
      const topupType = dto.topupType ?? TOPUP_TYPES[0];
      fields = {
        amount: amount.toFixed(2),
        period: null,
        dueDate: null,
        topupType,
        description: `${item.name} · ${topupType} · ${reference}`,
      };
    }

    const request = this.requests.create({
      userId,
      kind: item.kind,
      billerCode: item.code,
      reference,
      sourceAccountId: account.id,
      currency: biller.currency,
      idempotencyKey: dto.idempotencyKey,
      status: 'pending',
      ledgerTransactionId: null,
      ...fields,
    });
    try {
      return this.publicRequest(await this.requests.save(request), biller);
    } catch (error) {
      if ((error as any)?.code !== '23505') throw error;
      const raced = await this.requests.findOne({ where: { idempotencyKey: dto.idempotencyKey } });
      if (!raced) throw new ConflictException('La solicitud ya está siendo procesada.');
      this.assertSameRequest(raced, dto, userId);
      return this.publicRequest(raced, biller);
    }
  }

  async confirm(id: string, userId: string, dynamicCode: string) {
    const request = await this.requests.findOne({ where: { id, userId } });
    if (!request) throw new NotFoundException('Solicitud de pago no encontrada.');
    const biller = await this.billers.findByCode(request.billerCode);
    if (request.status === 'completed') return this.publicRequest(request, biller);
    if (request.status === 'cancelled') throw new ConflictException('La solicitud fue cancelada.');
    if (request.kind === 'bill') {
      const taken = await this.takenBy(request.billerCode, request.reference, request.period);
      if (taken && taken.id !== request.id) throw new ConflictException('Esta factura ya está pagada este mes.');
    }

    // Como en las transferencias: sin clave dinámica válida no se mueve dinero.
    await this.banking.verifyDynamicKey(userId, dynamicCode);

    if (!biller?.accountId) throw new ServiceUnavailableException('El convenio todavía no está disponible.');

    // Reclama la solicitud de forma atómica: pendiente, o 'processing' abandonada.
    // En facturas, el índice único parcial impide que dos solicitudes paguen la misma.
    let affected: number | undefined;
    try {
      const claim = await this.requests
        .createQueryBuilder()
        .update(PaymentRequest)
        .set({ status: 'processing' })
        .where('id = :id AND user_id = :userId', { id, userId })
        .andWhere("(status = 'pending' OR (status = 'processing' AND updated_at < :stale))", {
          stale: new Date(Date.now() - STALE_PROCESSING_MS),
        })
        .execute();
      affected = claim.affected;
    } catch (error) {
      if ((error as any)?.code === '23505')
        throw new ConflictException('Esta factura ya fue pagada o se está pagando.');
      throw error;
    }
    if (affected !== 1) {
      const latest = await this.requests.findOne({ where: { id, userId } });
      if (latest?.status === 'completed') return this.publicRequest(latest, biller);
      throw new ConflictException('La solicitud ya está siendo procesada.');
    }

    try {
      const transaction = await this.banking.pay({
        sourceAccountId: request.sourceAccountId,
        merchantAccountId: biller.accountId,
        amount: Number(request.amount),
        idempotencyKey: request.idempotencyKey,
        description: request.description,
      });
      request.status = 'completed';
      request.ledgerTransactionId = transaction.id ?? null;
      await this.requests.save(request);
      return this.publicRequest(request, biller);
    } catch (error) {
      await this.requests.update({ id, userId, status: 'processing' }, { status: 'pending' });
      throw error;
    }
  }

  /**
   * Recarga de un canje de Puntos Banklite (llamada interna de rewards-service).
   * El banco le paga al operador desde "Recompensas" con un solo asiento en el
   * ledger; queda registrada como recarga del cliente (sus "Últimas recargas").
   * Idempotente: con la misma clave nunca se paga dos veces.
   */
  async rewardTopup(dto: RewardTopupDto) {
    const existing = await this.requests.findOne({ where: { idempotencyKey: dto.idempotencyKey } });
    if (existing?.status === 'completed') return this.publicRequest(existing);
    if (
      existing &&
      (existing.userId !== dto.beneficiaryUserId ||
        existing.reference !== dto.phone ||
        Number(existing.amount) !== dto.amount)
    ) {
      throw new ConflictException('La clave de idempotencia ya se usó para otra recarga.');
    }

    const item = this.requireItem(dto.billerCode, 'topup');
    const biller = await this.billers.findByCode(item.code);
    if (!biller?.accountId) throw new ServiceUnavailableException(`${item.name} todavía no está disponible.`);

    let request = existing;
    if (!request) {
      request = this.requests.create({
        userId: dto.beneficiaryUserId,
        kind: 'topup',
        billerCode: item.code,
        reference: dto.phone,
        sourceAccountId: REWARDS_ACCOUNT_COP,
        currency: biller.currency,
        amount: dto.amount.toFixed(2),
        period: null,
        dueDate: null,
        topupType: 'Recarga de saldo',
        description: `${item.name} · Canje de Puntos Banklite · ${dto.phone}`,
        idempotencyKey: dto.idempotencyKey,
        status: 'processing',
        ledgerTransactionId: null,
      });
      try {
        request = await this.requests.save(request);
      } catch (error) {
        if ((error as any)?.code !== '23505') throw error;
        request = await this.requests.findOne({ where: { idempotencyKey: dto.idempotencyKey } });
        if (request?.status === 'completed') return this.publicRequest(request);
      }
    }

    try {
      const transaction = await this.banking.payFromRewards({
        merchantAccountId: biller.accountId,
        beneficiaryUserId: dto.beneficiaryUserId,
        amount: dto.amount,
        idempotencyKey: dto.idempotencyKey,
        description: request.description,
      });
      request.status = 'completed';
      request.ledgerTransactionId = transaction.id ?? null;
      await this.requests.save(request);
      return this.publicRequest(request, biller);
    } catch (error) {
      // No se pagó: la recarga queda cancelada y rewards-service devuelve los puntos.
      await this.requests.update({ id: request.id, status: 'processing' }, { status: 'cancelled' });
      throw error;
    }
  }

  async cancel(id: string, userId: string) {
    const request = await this.requests.findOne({ where: { id, userId } });
    if (!request) throw new NotFoundException('Solicitud de pago no encontrada.');
    if (request.status === 'cancelled') return this.publicRequest(request);
    if (request.status !== 'pending') throw new ConflictException('Solo se pueden cancelar solicitudes pendientes.');
    const result = await this.requests.update({ id, userId, status: 'pending' }, { status: 'cancelled' });
    if (result.affected !== 1) throw new ConflictException('La solicitud ya está siendo procesada.');
    request.status = 'cancelled';
    return this.publicRequest(request);
  }

  // =====================================================
  // AUXILIARES
  // =====================================================

  private requireItem(code: string, kind: BillerKind): CatalogItem {
    const item = catalogItem(code);
    if (!item || item.kind !== kind) {
      const what = { bill: 'Esa empresa', topup: 'Ese operador', qr: 'Ese comercio' }[kind];
      throw new NotFoundException(`${what} no está disponible.`);
    }
    return item;
  }

  private qrReference(biller: Biller, raw: string): string {
    const reference = normalizeReference(raw);
    if (reference !== biller.accountNumber)
      throw new BadRequestException('El código QR no corresponde a ese comercio.');
    return reference;
  }

  private validReference(item: CatalogItem, raw: string): string {
    const reference = normalizeReference(raw);
    if (item.kind === 'topup' && !PHONE.test(reference)) {
      throw new BadRequestException('Ingresa un celular de 10 dígitos que empiece por 3.');
    }
    if (item.kind === 'bill' && !BILL_REFERENCE.test(reference)) {
      throw new BadRequestException('La referencia debe tener entre 6 y 14 números.');
    }
    return reference;
  }

  /** Solicitud que ya pagó (o está pagando) esa factura del mes, si existe. */
  private takenBy(billerCode: string, reference: string, period: string | null) {
    return this.requests.findOne({
      where: { kind: 'bill', billerCode, reference, period, status: In(['processing', 'completed']) },
    });
  }

  private async billerMap() {
    return new Map((await this.billers.findAll()).map((biller) => [biller.code, biller]));
  }

  private assertSameRequest(request: PaymentRequest, dto: PreparePaymentDto, userId: string) {
    if (
      request.userId !== userId ||
      request.kind !== dto.kind ||
      request.billerCode !== dto.billerCode ||
      request.sourceAccountId !== dto.sourceAccountId ||
      request.reference !== normalizeReference(dto.reference) ||
      (dto.kind !== 'bill' && dto.amount !== undefined && Number(request.amount) !== Number(dto.amount))
    ) {
      throw new ConflictException('La clave de idempotencia ya se usó para otra solicitud.');
    }
  }

  private publicRequest(request: PaymentRequest, biller?: Biller | null) {
    const item = catalogItem(request.billerCode);
    return {
      id: request.id,
      kind: request.kind,
      billerCode: request.billerCode,
      billerName: item?.name ?? request.billerCode,
      service: item?.service ?? null,
      serviceName: payService(item?.service ?? null)?.name ?? null,
      // Últimos 4 dígitos de la cuenta de la empresa, para el comprobante.
      billerAccountLast4: biller?.accountNumber ? biller.accountNumber.slice(-4) : null,
      reference: request.reference,
      period: request.period,
      dueDate: request.dueDate,
      topupType: request.topupType,
      sourceAccountId: request.sourceAccountId,
      amount: Number(request.amount),
      currency: request.currency,
      description: request.description,
      status: request.status,
      ledgerTransactionId: request.ledgerTransactionId,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };
  }
}
