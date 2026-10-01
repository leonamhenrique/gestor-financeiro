// ============================================================
// seed-demo-report.ts
// ============================================================
// Um ano fictício completo para demonstrar o relatório de fluxo de caixa.
//
// Idempotente: roda quantas vezes quiser e o resultado é o mesmo. A chave
// é o e-mail do usuário de demonstração — tudo que ele tem é apagado e
// recriado. NÃO toca no seed de categorias: usa as que já existem (padrão
// do sistema) e cria as próprias só se faltar.
//
//   npx ts-node prisma/seed-demo-report.ts
// ============================================================

import { PrismaClient, TransactionType, AccountType } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();

const EMAIL = process.env.EMAIL_DEMO ?? 'demo-relatorio@local.test';
const ANO = Number(process.env.ANO_DEMO ?? new Date().getUTCFullYear());

/** Gerador determinístico: o mesmo seed dá sempre os mesmos números. */
function sorteio(semente: number) {
  let s = semente;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

const dia = (mes1: number, d: number) => new Date(Date.UTC(ANO, mes1 - 1, d));

async function main() {
  const existente = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (existente) {
    // Ordem de dependência: pagamento → fatura → lançamento → cartão/conta.
    await prisma.invoicePayment.deleteMany({ where: { bankAccount: { userId: existente.id } } });
    await prisma.creditCardInvoice.deleteMany({ where: { creditCard: { userId: existente.id } } });
    await prisma.transaction.deleteMany({ where: { userId: existente.id } });
    await prisma.transactionSeries.deleteMany({ where: { userId: existente.id } });
    await prisma.creditCard.deleteMany({ where: { userId: existente.id } });
    await prisma.bankAccount.deleteMany({ where: { userId: existente.id } });
    await prisma.category.deleteMany({ where: { userId: existente.id } });
  }

  // O usuário é PRESERVADO quando já existe: apagá-lo levaria junto a senha
  // de quem criou a conta pelo app para ver o relatório, e o seed deixaria
  // de ser repetível na prática. Só os dados financeiros são refeitos.
  const user =
    existente ??
    (await prisma.user.create({
      data: {
        email: EMAIL,
        name: 'Demonstração do relatório',
        // Hash inválido de propósito: este usuário nasce só para leitura.
        // Quem quiser entrar cria a conta pelo app e roda o seed com
        // EMAIL_DEMO apontando para ela.
        passwordHash: 'seed-demo-sem-login',
      },
    }));

  const conta = await prisma.bankAccount.create({
    data: {
      userId: user.id,
      institutionName: 'Banco da Demonstração',
      accountType: AccountType.CHECKING,
      initialBalance: 11340,
      currentBalance: 11340,
    },
  });

  // Um cartão que fecha dia 10 e vence dia 17: compra do dia 8 cai na fatura
  // do próprio mês, a do dia 22 cai na do mês seguinte. É o que exercita a
  // regra de "a despesa de cartão pesa no mês em que a fatura VENCE".
  const cartao = await prisma.creditCard.create({
    data: {
      userId: user.id,
      bankAccountId: conta.id,
      name: 'Cartão da Demonstração',
      limitAmount: 12000,
      closingDay: 10,
      dueDay: 17,
    },
  });

  // Usa as categorias padrão do sistema (userId null) e completa o que falta.
  const padrao = await prisma.category.findMany({ where: { userId: null } });
  const achar = async (nome: string, tipo: TransactionType) => {
    const ja = padrao.find((c) => c.name.toLowerCase() === nome.toLowerCase() && c.type === tipo);
    if (ja) return ja;
    return prisma.category.create({ data: { userId: user.id, name: nome, type: tipo } });
  };

  const salario = await achar('Salário', TransactionType.INCOME);
  const freela = await achar('Freelance', TransactionType.INCOME);
  const moradia = await achar('Moradia', TransactionType.EXPENSE);
  const alimentacao = await achar('Alimentação', TransactionType.EXPENSE);
  const transporte = await achar('Transporte', TransactionType.EXPENSE);
  const saude = await achar('Saúde', TransactionType.EXPENSE);
  const lazer = await achar('Lazer', TransactionType.EXPENSE);
  const educacao = await achar('Educação', TransactionType.EXPENSE);

  const hoje = new Date();
  const mesCorrente = hoje.getUTCFullYear() === ANO ? hoje.getUTCMonth() + 1 : 12;
  const rnd = sorteio(20260930);
  const linhas: any[] = [];

  const lancar = (
    mes: number,
    d: number,
    tipo: TransactionType,
    valor: number,
    categoryId: string,
    descricao: string,
    recorrente = false,
    noCartao = false,
  ) => {
    const passado = mes <= mesCorrente;
    linhas.push({
      id: randomUUID(),
      userId: user.id,
      // XOR: ou conta, ou cartão. Nunca os dois, nunca nenhum.
      bankAccountId: noCartao ? null : conta.id,
      creditCardId: noCartao ? cartao.id : null,
      categoryId,
      type: tipo,
      amount: valor.toFixed(2),
      description: descricao,
      transactionDate: dia(mes, d),
      isRecurring: recorrente,
      // Passado = dinheiro que já se moveu. Futuro = agendado, ainda previsto.
      isConfirmed: passado,
    });
  };

  for (let mes = 1; mes <= 12; mes++) {
    lancar(mes, 5, TransactionType.INCOME, 8500, salario.id, 'Salário', true);
    // 13º nos dois últimos meses, que é o que faz a virada do ano render.
    if (mes >= 11) lancar(mes, 20, TransactionType.INCOME, 4250, salario.id, '13º salário', false);
    if (mes % 3 === 0) lancar(mes, 18, TransactionType.INCOME, 900 + Math.round(rnd() * 800), freela.id, 'Freelance');

    // Fixos: mesma coisa todo mês, marcados como recorrentes.
    lancar(mes, 6, TransactionType.EXPENSE, 2200, moradia.id, 'Aluguel', true);
    lancar(mes, 10, TransactionType.EXPENSE, 540, moradia.id, 'Energia e internet', true);
    lancar(mes, 15, TransactionType.EXPENSE, 450, educacao.id, 'Mensalidade do curso', true);
    lancar(mes, 18, TransactionType.EXPENSE, 780, saude.id, 'Plano de saúde', true);

    // Variáveis: é deles que a estimativa do mês previsto sai.
    lancar(mes, 8, TransactionType.EXPENSE, 900 + Math.round(rnd() * 500), alimentacao.id, 'Mercado');
    lancar(mes, 12, TransactionType.EXPENSE, 300 + Math.round(rnd() * 250), transporte.id, 'Combustível');
    lancar(mes, 22, TransactionType.EXPENSE, 200 + Math.round(rnd() * 400), lazer.id, 'Restaurantes');

    // Duas compras no cartão por mês, dos dois lados do fechamento (dia 10):
    // a do dia 8 vence no próprio mês, a do dia 22 vence no mês seguinte.
    lancar(mes, 8, TransactionType.EXPENSE, 180 + Math.round(rnd() * 120), alimentacao.id, 'Supermercado no cartão', false, true);
    lancar(mes, 22, TransactionType.EXPENSE, 240 + Math.round(rnd() * 160), lazer.id, 'Compra no cartão', false, true);
  }

  await prisma.transaction.createMany({ data: linhas });

  // O saldo atual tem que bater com o que foi confirmado, senão o KPI
  // "saldo atual" contradiz o acumulado do gráfico.
  // Só o que passa pela conta mexe no saldo dela. Compra no cartão não
  // debita: ela vira fatura, e a fatura é paga à parte.
  const confirmadas = linhas.filter((l) => l.isConfirmed && l.bankAccountId);
  const delta = confirmadas.reduce(
    (s, l) => s + (l.type === TransactionType.INCOME ? Number(l.amount) : -Number(l.amount)),
    0,
  );
  await prisma.bankAccount.update({
    where: { id: conta.id },
    data: { currentBalance: (11340 + delta).toFixed(2) },
  });

  console.log(`usuário: ${EMAIL}`);
  console.log(`ano: ${ANO} · lançamentos: ${linhas.length} · confirmados: ${confirmadas.length}`);
  console.log(`saldo atual: ${(11340 + delta).toFixed(2)}`);
  console.log(`userId: ${user.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
