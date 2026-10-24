// ============================================================
// dto/create-transaction.dto.ts
// ============================================================
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsUUID,
  IsEnum,
  IsNumber,
  IsPositive,
  IsOptional,
  IsString,
  IsDateString,
  IsBoolean,
  IsIn,
  IsInt,
  Length,
  Matches,
  Min,
  Max,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { TransactionType, TransactionSource, SeriesKind, SeriesFrequency } from '@prisma/client';

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const MES_MSG = 'Use o mês no formato AAAA-MM.';

// Repetição fixa (conta mensal) ou parcelamento. Cada ocorrência vira um
// lançamento; só a primeira respeita isConfirmed e invoiceMonth.
export class RepeatDto {
  @IsEnum(SeriesKind)
  kind: SeriesKind;

  @IsEnum(SeriesFrequency)
  frequency: SeriesFrequency;

  @IsInt()
  @Min(2, { message: 'Uma série tem pelo menos 2 ocorrências.' })
  @Max(60, { message: 'Uma série tem no máximo 60 ocorrências.' })
  count: number;
}

export class CreateTransactionDto {
  // Chave de idempotência gerada pelo cliente. Mandar a mesma chave duas
  // vezes devolve o lançamento que já existe, em vez de criar outro — é o
  // que protege o reenvio da fila offline de dobrar o dinheiro quando a
  // resposta se perde no caminho. Opcional: quem não manda segue como antes.
  @IsOptional()
  @IsString()
  @Length(8, 64)
  @Matches(/^[A-Za-z0-9_.:-]+$/, { message: 'clientKey aceita letras, números e _ . : -' })
  clientKey?: string;

  // Fatura em que a compra entra, quando não é a da data (só cartão).
  @IsOptional()
  @Matches(MES, { message: MES_MSG })
  invoiceMonth?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => RepeatDto)
  repeat?: RepeatDto;

  @IsEnum(TransactionType)
  type: TransactionType;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive({ message: 'O valor deve ser maior que zero.' })
  amount: number;

  @IsUUID()
  categoryId: string;

  @IsDateString()
  transactionDate: string; // ISO string, convertido para Date no service

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isRecurring?: boolean;

  // false = previsto: gravado, mas sem mexer no saldo nem na fatura até ser
  // confirmado. Omitido = confirmado (compatível com quem já usa a API).
  @IsOptional()
  @IsBoolean()
  isConfirmed?: boolean;

  @IsOptional()
  @IsEnum(TransactionSource)
  source?: TransactionSource;

  // Exatamente um dos dois deve ser informado.
  // A validação de XOR (não pode ter os dois nem nenhum) é feita
  // no service, pois class-validator não expressa XOR de forma limpa
  // entre dois campos opcionais.
  @ValidateIf((o) => !o.creditCardId)
  @IsUUID()
  bankAccountId?: string;

  @ValidateIf((o) => !o.bankAccountId)
  @IsUUID()
  creditCardId?: string;
}

// ============================================================
// dto/update-transaction.dto.ts
// ============================================================
export class UpdateTransactionDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  // Sinal e destino são editáveis: o update estorna o efeito antigo e aplica
  // o novo, então trocar de conta, de cartão ou de tipo é só uma versão
  // diferente do mesmo lançamento. Mandar os dois destinos, ou nenhum, é
  // recusado pelo `validateAccountXorCard` de sempre.
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @IsOptional()
  @IsUUID()
  bankAccountId?: string | null;

  @IsOptional()
  @IsUUID()
  creditCardId?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive({ message: 'O valor deve ser maior que zero.' })
  amount?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  transactionDate?: string;

  // true confirma um previsto (aplica no saldo/fatura); false volta a previsto
  // (desfaz). Pode vir junto com valor e data na mesma edição.
  @IsOptional()
  @IsBoolean()
  isConfirmed?: boolean;

  // 'AAAA-MM' move a compra para outra fatura; null volta para a da data.
  @IsOptional()
  @ValidateIf((o) => o.invoiceMonth !== null)
  @Matches(MES, { message: MES_MSG })
  invoiceMonth?: string | null;
}

export class DeleteSeriesQueryDto {
  // ONLY = só esta; FOLLOWING = esta e as seguintes; ALL = a série toda.
  @IsIn(['ONLY', 'FOLLOWING', 'ALL'])
  scope: 'ONLY' | 'FOLLOWING' | 'ALL';
}

/** De quantos meses as parcelas seguintes andam. Negativo puxa para tras. */
export class ShiftInvoiceDto {
  @IsInt()
  @Min(-60)
  @Max(60)
  months: number;
}

export class AnticipateDto {
  @Matches(MES, { message: MES_MSG })
  destinationMonth: string;

  @IsInt()
  @Min(1)
  @Max(60)
  quantity: number;

  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}

// ============================================================
// dto/list-transactions-query.dto.ts
// ============================================================
// Query params para filtro por data na listagem (requisito do MVP:
// "Transações filtráveis e organizáveis por data")
export class ListTransactionsQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  bankAccountId?: string;

  @IsOptional()
  @IsUUID()
  creditCardId?: string;

  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  // CONFIRMED = só o que já afetou o saldo; PLANNED = só os previstos.
  @IsOptional()
  @IsIn(['CONFIRMED', 'PLANNED'])
  status?: 'CONFIRMED' | 'PLANNED';

  @IsOptional()
  @IsUUID()
  seriesId?: string;

  // Lançamentos de conta oculta ficam fora por padrão; true inclui.
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeHidden?: boolean;
}

/**
 * Reclassificar vários lançamentos de uma vez.
 *
 * Os IDS vêm do cliente, e não um nome de lojista para o servidor casar: a
 * normalização que descobre o lojista ("MercadolivreEritecha - Parcela 5/12"
 * → "mercadolivreeritecha") vive no app, e reescrevê-la aqui criaria duas
 * implementações da mesma regra em linguagens diferentes. Elas divergem com o
 * tempo, e aí o que a tela mostra deixa de ser o que o servidor muda.
 *
 * O servidor confere a posse de cada id — é o que impede o cliente de mandar
 * um id alheio junto na lista.
 */
export const MAX_RECLASSIFICAR = 500;

export class BulkCategoryDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RECLASSIFICAR)
  @IsUUID('4', { each: true })
  ids!: string[];

  @IsUUID()
  categoryId!: string;
}

// ============================================================
// Importação de extrato
// ============================================================

/**
 * Teto de um lote. O extrato real medido tinha 74 linhas; 500 é folga larga
 * e, ao mesmo tempo, impede que um pedido forjado abra uma transação de banco
 * que não termina mais.
 */
export const MAX_LOTE_IMPORTACAO = 500;

/**
 * Uma linha do extrato. É o mesmo lançamento de sempre, sem o que não faz
 * sentido aqui: `repeat` (a série de uma compra parcelada é montada pelo app,
 * linha a linha) e `clientKey` (ela é derivada do lote mais a posição — ver
 * `criarEmLote` —, e deixar o cliente escolhê-la abriria a porta para duas
 * linhas do mesmo lote colidirem entre si).
 *
 * Escrita campo a campo em vez de herdada de `CreateTransactionDto`: tirar
 * dois campos de uma classe pede `@nestjs/mapped-types`, que este projeto não
 * usa, e trazer uma dependência para economizar vinte linhas seria caro pelo
 * que entrega.
 */
export class ImportItemDto {
  @IsEnum(TransactionType)
  type!: TransactionType;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive({ message: 'O valor deve ser maior que zero.' })
  amount!: number;

  @IsUUID()
  categoryId!: string;

  @IsDateString()
  transactionDate!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isConfirmed?: boolean;

  // A fatura do extrato: um arquivo é de UMA fatura, e todas as linhas entram
  // nela mesmo as de datas anteriores.
  @IsOptional()
  @Matches(MES, { message: MES_MSG })
  invoiceMonth?: string;

  // XOR conferido no service, como no lançamento avulso.
  @ValidateIf((o) => !o.creditCardId)
  @IsUUID()
  bankAccountId?: string;

  @ValidateIf((o) => !o.bankAccountId)
  @IsUUID()
  creditCardId?: string;
}

export class ImportBatchDto {
  /**
   * O id do lote, gerado pelo app. Vem do cliente, e não do servidor, porque
   * é ele que torna o reenvio seguro: a mesma importação mandada duas vezes
   * carrega o mesmo lote e as mesmas chaves, e a segunda não lança nada de
   * novo. Um id gerado aqui mudaria a cada tentativa.
   */
  @IsString()
  @Length(8, 64)
  @Matches(/^[A-Za-z0-9_.:-]+$/, { message: 'batchId aceita letras, números e _ . : -' })
  batchId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_LOTE_IMPORTACAO)
  @ValidateNested({ each: true })
  @Type(() => ImportItemDto)
  items!: ImportItemDto[];
}
