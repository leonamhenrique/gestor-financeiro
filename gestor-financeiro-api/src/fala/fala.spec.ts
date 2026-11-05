// ============================================================
// fala.spec.ts
// ============================================================
// Duas coisas, e a primeira é a que importa:
//
//   1. o `fala.js` versionado é o recorte do `web/index.html` DE AGORA.
//      Sem isto, mexer na leitura da frase no app deixaria o WhatsApp lendo
//      pela gramática de semanas atrás — e ninguém descobriria, porque as
//      duas continuariam funcionando, cada uma do seu jeito;
//   2. a leitura funciona fora do navegador: com o contexto vindo do banco,
//      e estourando com nome e sobrenome se alguém esquecer de passá-lo.
// ============================================================

import * as fs from 'fs';
import { gerar, DESTINO } from '../../scripts/gerar-fala';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fala = require('./fala.js');

const ctx = () => ({
  contas: [
    { id: 'a1', nome: 'Nubank', isActive: true },
    { id: 'a2', nome: 'Cofre', isActive: true },
  ],
  cartoes: [{ id: 'k1', nome: 'Nubank Roxinho', contaId: 'a1' }],
  categorias: [
    { id: 'c1', nome: 'Alimentação', tipo: 'EXPENSE' },
    { id: 'c9', nome: 'Compras', tipo: 'EXPENSE' },
    { id: 'c4', nome: 'Freelance', tipo: 'INCOME' },
  ],
  regras: [{ id: 'r1', lojista: 'magazine', rotulo: 'Magazine', categoriaId: 'c9' }],
  hoje: new Date(2026, 9, 29),
});

describe('fala.js — a mesma leitura da tela, fora dela', () => {
  /* A quebra de linha sai da comparação, e não é detalhe de gosto.
   *
   * O `index.html` é lido do disco, e no Windows o git entrega o arquivo com
   * CRLF (`core.autocrlf`); o recorte então carrega esses `\r` para dentro do
   * texto gerado, enquanto o arquivo versionado volta do commit com LF. O
   * teste ficava vermelho mostrando 425 linhas "diferentes" que eram iguais
   * letra por letra — e o que ele existe para pegar é a REGRA que mudou no
   * app, não o sistema operacional de quem roda `npm test`. */
  const semCR = (s: string) => s.replace(/\r\n/g, '\n');

  it('o arquivo versionado bate com o app de agora', () => {
    const noDisco = fs.readFileSync(DESTINO, 'utf8');
    // Falhou? A leitura mudou no app. Rode `npm run sync:fala` e confira o
    // diff: é a sua própria mudança chegando ao WhatsApp.
    expect(semCR(noDisco)).toBe(semCR(gerar()));
  });

  it('le a frase com o contexto do banco', () => {
    const r = fala.interpretarFala(
      'gastei 40 reais no mercado pelo debito da conta Nubank categoria alimentacao',
      ctx(),
    );
    expect(r).toMatchObject({
      tipo: 'EXPENSE',
      valor: 40,
      desc: 'Mercado',
      contaId: 'a1',
      categoriaId: 'c1',
      data: '2026-10-29',
      confirmada: true,
      faltando: [],
    });
  });

  it('a regra de lojista do usuario classifica o que a frase nao disse', () => {
    const r = fala.interpretarFala('compra no pix na magazine valor de 10 pago nubank', ctx());
    expect(r.desc).toBe('Magazine');
    expect(r.categoriaId).toBe('c9');
    expect(r.categoriaDoLojista).toBe(true);
  });

  it('o que falta vem dito, para a resposta poder perguntar', () => {
    const r = fala.interpretarFala('gastei 30 reais', ctx());
    expect(r.faltando).toEqual(['destino', 'categoria']);
  });

  it('transferencia sai por outro caminho, com as contas na ordem', () => {
    const r = fala.interpretarFala('transferencia de 100 do Nubank para o Cofre', ctx());
    expect(r.transferencia).toBe(true);
    expect([r.deId, r.paraId]).toEqual(['a1', 'a2']);
  });

  it('o cartao e a fatura ditos sao entendidos', () => {
    const r = fala.interpretarFala(
      'despesa de 80 no cartao Nubank Roxinho categoria alimentacao fatura de dezembro',
      ctx(),
    );
    expect(r.cartaoId).toBe('k1');
    expect(r.faturaMes).toBe('2026-12');
  });

  describe('a chave do lojista ignora o "loja das" do comeco', () => {
    // O caso medido: "comprei na loja das Casas Bahia" hoje e "comprei nas
    // Casas Bahia" amanha geravam chaves diferentes, o aprendizado nao
    // reconhecia a loja da vespera e a pessoa ganhava DUAS regras para o
    // mesmo lugar.
    it('as duas formas de dizer a mesma loja dao a mesma chave', () => {
      expect(fala.chaveDeLojista('Loja das Casas Bahia')).toBe('casasbahia');
      expect(fala.chaveDeLojista('Casas Bahia')).toBe('casasbahia');
      expect(fala.chaveDeLojista('Lojas Americanas')).toBe('americanas');
    });

    it('o que sobra tem de identificar a loja', () => {
      // Chave curta e chave perigosa: o casamento e por comeco, e uma regra
      // de uma letra classificaria tudo que comecasse com ela.
      expect(fala.chaveDeLojista('Loja A')).toBe('lojaa');
      expect(fala.chaveDeLojista('Loja')).toBe('loja');
    });

    it('palavra generica so cai quando e palavra, e no comeco', () => {
      // "Lojaria" nao e "loja"; "Mercado Livre" e nome de gente.
      expect(fala.chaveDeLojista('Lojaria do Ze')).toBe('lojariadoze');
      expect(fala.chaveDeLojista('Mercado Livre')).toBe('mercadolivre');
      expect(fala.chaveDeLojista('Padaria da Loja Velha')).toBe('padariadalojavelha');
    });

    it('a regra aprendida pega as duas formas', () => {
      const regras = [{ id: 'r1', lojista: 'casasbahia', rotulo: 'Casas Bahia', categoriaId: 'c9' }];
      expect(fala.regraDoLojista(regras, 'Loja das Casas Bahia')?.id).toBe('r1');
      expect(fala.regraDoLojista(regras, 'Casas Bahia')?.id).toBe('r1');
      expect(fala.regraDoLojista(regras, 'Casas Bahia - Parcela 2/3')?.id).toBe('r1');
    });

    it('regra JA APRENDIDA com a chave longa continua valendo', () => {
      // Sem isto, quem ensinou "loja das casas bahia" antes desta mudanca
      // veria o app esquecer uma classificacao que ela mesma ensinou -- e e
      // o que dispensa migrar chave no banco.
      const antigas = [
        { id: 'r0', lojista: 'lojadascasasbahia', rotulo: 'Loja das Casas Bahia', categoriaId: 'c9' },
      ];
      expect(fala.regraDoLojista(antigas, 'Loja das Casas Bahia')?.id).toBe('r0');
    });

    it('a frase inteira chega na categoria pelas duas formas', () => {
      const comRegra = { ...ctx(), regras: [{ id: 'r1', lojista: 'casasbahia', rotulo: 'Casas Bahia', categoriaId: 'c9' }] };
      for (const f of [
        'comprei 10 na loja das casas bahia no debito da conta Nubank',
        'comprei 10 nas casas bahia no debito da conta Nubank',
      ]) {
        expect(fala.interpretarFala(f, comRegra)).toMatchObject({ categoriaId: 'c9', faltando: [] });
      }
    });
  });

  describe('"em 3 vezes" e "de 3 vezes" sao a mesma compra', () => {
    const parcelas = (frase: string) => {
      const r = fala.interpretarFala(frase + ' no cartao Nubank Roxinho categoria compras', ctx());
      return [r.parcelas, r.valor, r.valorTotal];
    };

    it('a preposicao nao muda o significado', () => {
      // O transcritor escreve o que se fala ("parcelados de 3 vezes"); o
      // dedo escreve "3x". Era a mesma compra virando dois lancamentos.
      for (const f of [
        'comprei 20 em 3x',
        'comprei 20 em 3 vezes',
        'comprei 20 de 3 vezes',
        'comprei 20 parcelado de 3x',
        'comprei 20 parcelados de 3 vezes',
        'comprei 20 dividido em 3 parcelas',
        'comprei 20 em tres vezes',
      ]) {
        expect(parcelas(f)).toEqual([3, 6.67, 20.01]);
      }
    });

    it('o sufixo e o que segura o falso positivo', () => {
      // "de 3 reais" nao e parcelamento; sem x/vezes/parcelas, nada feito.
      const r = fala.interpretarFala('comprei um pao de 3 reais no cartao Nubank Roxinho categoria compras', ctx());
      expect(r.parcelas).toBeUndefined();
    });

    it('divisao torta vem marcada; parcela dita, nao', () => {
      const torta = fala.interpretarFala('comprei 20 em 3x no cartao Nubank Roxinho categoria compras', ctx());
      expect(torta.valorDito).toBe(20);
      const dita = fala.interpretarFala('comprei 3x de 20 no cartao Nubank Roxinho categoria compras', ctx());
      expect(dita.valorDito).toBeUndefined();
      expect([dita.parcelas, dita.valor, dita.valorTotal]).toEqual([3, 20, 60]);
    });

    it('divisao exata nao tem o que avisar', () => {
      const r = fala.interpretarFala('comprei 30 em 3x no cartao Nubank Roxinho categoria compras', ctx());
      expect([r.parcelas, r.valor, r.valorTotal]).toEqual([3, 10, 30]);
      expect(r.valorDito).toBeUndefined();
    });
  });

  describe('fatura virada: a fala escolhe a mesma que a tela', () => {
    // Cartão que fecha dia 1, o do caso. A fatura de dezembro junta 02/11 a
    // 01/12; virada em 23/11, a compra de 25/11 vai para a de janeiro.
    const cartao = (viradas: Record<string, string> = {}) => ({
      id: 'k1',
      nome: 'Nubank Roxinho',
      contaId: 'a1',
      fechamento: 1,
      viradas,
    });

    it('sem virada, a compra de 25/11 cai na fatura de dezembro', () => {
      expect(fala.monthKey(fala.faturaSugerida('2026-11-25', cartao()))).toBe('2026-12');
    });

    it('com a de dezembro virada em 23/11, ela cai na de janeiro', () => {
      expect(fala.monthKey(fala.faturaSugerida('2026-11-25', cartao({ '2026-12': '2026-11-23' })))).toBe('2027-01');
    });

    it('a compra do dia da virada já vai para a seguinte; a de antes, não', () => {
      const k = cartao({ '2026-12': '2026-11-23' });
      expect(fala.monthKey(fala.faturaSugerida('2026-11-23', k))).toBe('2027-01');
      expect(fala.monthKey(fala.faturaSugerida('2026-11-22', k))).toBe('2026-12');
    });

    it('cartão sem o campo (estado antigo) não quebra a conta', () => {
      expect(fala.monthKey(fala.faturaSugerida('2026-11-25', { id: 'k1', nome: 'X', fechamento: 1 }))).toBe('2026-12');
    });
  });

  describe('dinheiro escrito à brasileira', () => {
    const v = (t: string) => fala.valorDaFala(fala.normalizarFala(t));

    it('ponto de milhar SEM R$ nao perde o que vem depois', () => {
      // O defeito: "gastei 1.234,56" virava um lancamento de R$ 1,00. Pelo
      // WhatsApp isso chega como texto digitado, que e justamente onde a
      // pessoa escreve o ponto.
      expect(v('gastei 1.234,56 no mercado')).toBe(1234.56);
      expect(v('gastei 5.000 no mercado')).toBe(5000);
      expect(v('gastei 1.234.567,89 no mercado')).toBe(1234567.89);
    });

    it('"mil" multiplica o numero que vem antes', () => {
      expect(v('gastei 5 mil no mercado')).toBe(5000);
      expect(v('gastei 5 mil reais no mercado')).toBe(5000);
    });

    it('o que ja funcionava continua', () => {
      expect(v('gastei 50 no mercado')).toBe(50);
      expect(v('gastei 50,90 no mercado')).toBe(50.9);
      expect(v('gastei R$ 5.000,00 no mercado')).toBe(5000);
      expect(v('gastei cinco mil reais no mercado')).toBe(5000);
      expect(v('gastei dez reais no mercado')).toBe(10);
    });

    it('dia, prazo e ano continuam sem virar valor', () => {
      expect(v('comprei no dia 12 no mercado 30 reais')).toBe(30);
      expect(v('pago em 10 dias 40 reais')).toBe(40);
      expect(v('fatura de setembro de 2026 valor 80')).toBe(80);
    });
  });

  it('sem contexto, estoura dizendo o que faltou', () => {
    // Falha fechada: sem isto a frase seria lida contra listas vazias e a
    // resposta diria "não identifiquei a conta" sem explicação nenhuma.
    expect(() => fala.interpretarFala('gastei 10 no mercado')).toThrow(/contexto/);
  });
});
