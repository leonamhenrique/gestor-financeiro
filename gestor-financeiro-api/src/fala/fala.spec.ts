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
  it('o arquivo versionado bate com o app de agora', () => {
    const noDisco = fs.readFileSync(DESTINO, 'utf8');
    // Falhou? A leitura mudou no app. Rode `npm run sync:fala` e confira o
    // diff: é a sua própria mudança chegando ao WhatsApp.
    expect(noDisco).toBe(gerar());
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

  it('sem contexto, estoura dizendo o que faltou', () => {
    // Falha fechada: sem isto a frase seria lida contra listas vazias e a
    // resposta diria "não identifiquei a conta" sem explicação nenhuma.
    expect(() => fala.interpretarFala('gastei 10 no mercado')).toThrow(/contexto/);
  });
});
