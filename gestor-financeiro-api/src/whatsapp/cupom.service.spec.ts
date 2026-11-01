// ============================================================
// cupom.service.spec.ts
// ============================================================
// O que volta do leitor de imagem não é confiável, e este arquivo é o que
// trata isso como fato, não como suspeita: o modelo pode devolver texto no
// lugar de número, trinta parcelas de uma compra à vista, uma data que não é
// data — ou, o pior caso, os dígitos do cartão dentro do nome da loja.
//
// Nenhum byte sai daqui nos testes: o que se prova é a conferência.
// ============================================================

import { CupomService } from './cupom.service';

describe('CupomService', () => {
  let service: CupomService;

  beforeEach(() => {
    service = new CupomService();
    delete process.env.VISION_PROVIDER;
    delete process.env.VISION_API_KEY;
  });

  /** A conferência é privada de propósito; o teste a alcança pelo nome. */
  const conferir = (bruto: unknown) => (service as any).conferir(bruto);

  describe('o padrão é cego', () => {
    it('sem as duas variáveis, não enxerga', () => {
      expect(service.disponivel()).toBe(false);
      process.env.VISION_PROVIDER = 'openai';
      expect(service.disponivel()).toBe(false);
      process.env.VISION_API_KEY = 'k';
      expect(service.disponivel()).toBe(true);
    });

    it('sem leitor, `ler` nem tenta baixar a imagem', async () => {
      await expect(service.ler('img-1')).resolves.toBeNull();
    });
  });

  describe('o que volta do leitor é conferido', () => {
    const cheio = { total: 182.94, data: '2026-10-30', parcelas: 1, estabelecimento: 'DMA Distribuidora' };

    it('o cupom completo passa', () => {
      expect(conferir(cheio)).toEqual({
        valor: 182.94,
        data: '2026-10-30',
        parcelas: 1,
        estabelecimento: 'DMA Distribuidora',
      });
    });

    it('sem valor não há cupom', () => {
      // É o único campo sem o qual não dá para seguir: sem ele o lançamento
      // seria um palpite.
      for (const total of [null, 0, -5, 'cento e oitenta', NaN, 2_000_000]) {
        expect(conferir({ ...cheio, total })).toBeNull();
      }
    });

    it('data que não é data vira nula, e o resto segue', () => {
      for (const data of ['30/10/2026', '2026-13-45', 'ontem', null, 7]) {
        expect(conferir({ ...cheio, data })).toMatchObject({ valor: 182.94, data: null });
      }
    });

    it('parcela fora da faixa vira à vista', () => {
      for (const parcelas of [null, 0, 1, -3, 99, 'três', 1.5]) {
        expect(conferir({ ...cheio, parcelas })?.parcelas).toBe(1);
      }
      expect(conferir({ ...cheio, parcelas: 3 })?.parcelas).toBe(3);
      expect(conferir({ ...cheio, parcelas: '12' })?.parcelas).toBe(12);
    });

    it('NÚMERO NENHUM sobrevive no nome da loja', () => {
      // A instrução em texto proíbe devolver cartão; isto é o que garante.
      // Mesmo que o leitor desobedeça, nenhum dígito vira descrição.
      const r = conferir({ ...cheio, estabelecimento: 'DMA Loja 042 CARTAO 429154-5610' });
      expect(r?.estabelecimento).toBe('DMA Loja CARTAO');
      expect(r?.estabelecimento).not.toMatch(/\d/);
    });

    it('nome curto demais ou vazio vira nulo', () => {
      for (const estabelecimento of ['', '   ', '42', null, 7]) {
        expect(conferir({ ...cheio, estabelecimento })?.estabelecimento).toBeNull();
      }
    });

    it('o valor chega com dois decimais', () => {
      expect(conferir({ ...cheio, total: '182.9449' })?.valor).toBe(182.94);
      expect(conferir({ ...cheio, total: 10 })?.valor).toBe(10);
    });
  });
});
