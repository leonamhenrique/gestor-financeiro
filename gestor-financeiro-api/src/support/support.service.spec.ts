// ============================================================
// support.service.spec.ts
// ============================================================
// As telas de Suporte e Ideias eram maquete: diziam "enviado" e limpavam o
// campo. Quem escrevia ficava esperando uma resposta que nunca ia existir.
//
// O que estes testes defendem, em ordem:
//
//   1. A MENSAGEM SAI, e sai para o endereço de contato.
//   2. DÁ PARA RESPONDER. Sem `Reply-To` com o e-mail de quem escreveu,
//      responder exige procurar a pessoa no banco — e ninguém faz isso
//      duas vezes.
//   3. NENHUM DADO FINANCEIRO VAI JUNTO. Nenhum problema de tela se
//      resolve com o saldo de alguém, e e-mail é o último lugar onde esse
//      dado deveria estar.
//   4. SEM SERVIÇO DE E-MAIL, A TELA SABE ANTES. Um "enviar" que sempre
//      falha é a maquete de novo, agora com erro.
// ============================================================

import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException, BadRequestException } from '@nestjs/common';
import { SupportService, enderecoDeContato, LIMITE_DO_TEXTO } from './support.service';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { MAILER, MensagemDoUsuario } from '../auth/mailer.port';

describe('SupportService', () => {
  let service: SupportService;
  let enviados: Array<{ msg: MensagemDoUsuario; para: string }>;
  let mailer: any;
  let prisma: any;
  const antes = { ...process.env };

  const montar = async () => {
    const modulo: TestingModule = await Test.createTestingModule({
      providers: [
        SupportService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: BillingService,
          useValue: {
            limites: jest.fn().mockResolvedValue({ coluna: 'pro', emTeste: false, diasDeTeste: 0 }),
          },
        },
        { provide: MAILER, useValue: mailer },
      ],
    }).compile();
    service = modulo.get(SupportService);
  };

  beforeEach(async () => {
    enviados = [];
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'u1',
          name: 'Ana Souza',
          email: 'ana@ex.com',
        }),
      },
    };
    mailer = {
      disponivel: true,
      enviarRedefinicaoDeSenha: jest.fn(),
      enviarMensagemDoUsuario: jest.fn(async (msg: MensagemDoUsuario, para: string) => {
        enviados.push({ msg, para });
      }),
    };
    await montar();
  });

  afterEach(() => {
    process.env = { ...antes };
  });

  it('manda para o endereço de contato', async () => {
    await service.enviar('u1', 'SUPORTE', 'A fatura não fecha.');
    expect(enviados).toHaveLength(1);
    expect(enviados[0].para).toBe('contato@saldonline.com.br');
  });

  it('o endereço vem do ambiente quando existe, sem deploy', async () => {
    process.env.SUPPORT_EMAIL = 'ajuda@outro.com.br';
    await montar();
    await service.enviar('u1', 'IDEIA', 'Podia ter modo escuro no site.');
    expect(enviados[0].para).toBe('ajuda@outro.com.br');
    expect(enderecoDeContato()).toBe('ajuda@outro.com.br');
  });

  /* Sem isto, responder exige procurar a pessoa no banco. */
  it('leva quem escreveu, para dar para responder', async () => {
    await service.enviar('u1', 'SUPORTE', 'A fatura não fecha.');
    expect(enviados[0].msg.de).toEqual({ nome: 'Ana Souza', email: 'ana@ex.com', id: 'u1' });
  });

  it('o tipo distingue suporte de ideia', async () => {
    await service.enviar('u1', 'IDEIA', 'uma ideia');
    expect(enviados[0].msg.tipo).toBe('IDEIA');
  });

  it('o plano vai junto, para poupar a primeira pergunta', async () => {
    await service.enviar('u1', 'SUPORTE', 'oi');
    expect(enviados[0].msg.contexto?.plano).toBe('pro');
  });

  /* Contexto é cortesia, não requisito: a mensagem é mais importante que o
   * plano de quem a mandou. */
  it('se o plano não puder ser lido, a mensagem vai mesmo assim', async () => {
    const modulo: TestingModule = await Test.createTestingModule({
      providers: [
        SupportService,
        { provide: PrismaService, useValue: prisma },
        { provide: BillingService, useValue: { limites: jest.fn().mockRejectedValue(new Error('fora')) } },
        { provide: MAILER, useValue: mailer },
      ],
    }).compile();
    await modulo.get(SupportService).enviar('u1', 'SUPORTE', 'oi');
    expect(enviados).toHaveLength(1);
    expect(enviados[0].msg.contexto?.plano).toBe('—');
  });

  /* A trava que mais importa deste arquivo. */
  it('nada financeiro atravessa: só nome, e-mail, id, plano e versão', async () => {
    await service.enviar('u1', 'SUPORTE', 'oi');
    const chaves = Object.keys(enviados[0].msg.contexto ?? {});
    expect(chaves.sort()).toEqual(['plano', 'versao']);
    const tudo = JSON.stringify(enviados[0].msg).toLowerCase();
    for (const proibido of ['saldo', 'balance', 'amount', 'cartao', 'cpf', 'senha']) {
      expect(tudo).not.toContain(proibido);
    }
  });

  it('mensagem vazia não vira e-mail', async () => {
    await expect(service.enviar('u1', 'SUPORTE', '   ')).rejects.toBeInstanceOf(BadRequestException);
    expect(enviados).toHaveLength(0);
  });

  it('mensagem gigante é recusada antes de sair', async () => {
    const enorme = 'a'.repeat(LIMITE_DO_TEXTO + 1);
    await expect(service.enviar('u1', 'SUPORTE', enorme)).rejects.toBeInstanceOf(BadRequestException);
    expect(enviados).toHaveLength(0);
  });

  it('o texto vai sem os espaços das pontas, como a pessoa quis dizer', async () => {
    await service.enviar('u1', 'SUPORTE', '  a fatura não fecha  ');
    expect(enviados[0].msg.texto).toBe('a fatura não fecha');
  });

  describe('sem serviço de e-mail', () => {
    beforeEach(async () => {
      mailer = { disponivel: false, enviarRedefinicaoDeSenha: jest.fn() };
      await montar();
    });

    it('a tela sabe antes de oferecer o formulário', () => {
      expect(service.disponivel()).toBe(false);
    });

    it('e enviar diz isso, em vez de fingir que foi', async () => {
      await expect(service.enviar('u1', 'SUPORTE', 'oi')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });

  /* `MAIL_PROVIDER=NONE` e um mailer antigo que não conheça o método dão no
   * mesmo: não há como entregar, e a tela tem de saber. */
  it('mailer sem o método de mensagem também conta como indisponível', async () => {
    mailer = { disponivel: true, enviarRedefinicaoDeSenha: jest.fn() };
    await montar();
    expect(service.disponivel()).toBe(false);
  });
});
