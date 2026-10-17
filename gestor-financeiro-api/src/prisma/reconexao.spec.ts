// ============================================================
// reconexao.spec.ts
// ============================================================
// O Neon fecha conexao ociosa e a instancia do Render hiberna. Quando ela
// acorda, o pool do Prisma guarda sockets que o banco ja descartou -- e a
// primeira consulta falha com "Server has closed the connection".
//
// Medido em producao: servico no ar as 07:43, erro as 08:40, na primeira
// consulta depois de quase uma hora parada. O pedido nunca chegou ao banco.
// ============================================================

import { conexaoMorreu, comReconexao } from './prisma.service';

describe('conexaoMorreu()', () => {
  it('reconhece os codigos do Prisma para conexao perdida', () => {
    expect(conexaoMorreu({ code: 'P1017' })).toBe(true); // servidor fechou
    expect(conexaoMorreu({ code: 'P1001' })).toBe(true); // nao alcancavel
  });

  it('reconhece pela mensagem, que e como o erro de producao chegou', () => {
    expect(conexaoMorreu(new Error('Server has closed the connection.'))).toBe(true);
    expect(conexaoMorreu(new Error('read ECONNRESET'))).toBe(true);
  });

  // A parte que importa: repetir um pedido RECUSADO seria repetir o erro, e
  // repetir um que violou unicidade poderia mascarar um defeito de verdade.
  it('NAO confunde erro de pedido com erro de conexao', () => {
    expect(conexaoMorreu({ code: 'P2002' })).toBe(false); // unicidade
    expect(conexaoMorreu({ code: 'P2025' })).toBe(false); // nao encontrado
    expect(conexaoMorreu({ code: 'P2028' })).toBe(false); // transacao expirada
    expect(conexaoMorreu(new Error('O valor deve ser maior que zero.'))).toBe(false);
    expect(conexaoMorreu(undefined)).toBe(false);
    expect(conexaoMorreu(null)).toBe(false);
  });
});

describe('comReconexao()', () => {
  it('nao repete o que deu certo de primeira', async () => {
    const fn = jest.fn(async () => 'ok');
    expect(await comReconexao(fn)).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('repete UMA vez quando a conexao estava morta, e entrega o resultado', async () => {
    let tentativas = 0;
    const fn = jest.fn(async () => {
      tentativas++;
      if (tentativas === 1) throw Object.assign(new Error('Server has closed the connection.'), { code: 'P1017' });
      return 'ok na segunda';
    });

    expect(await comReconexao(fn)).toBe('ok na segunda');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  // Uma vez, e nao em laco: se a segunda tambem falhar, o banco esta fora de
  // verdade, e insistir transformaria uma falha rapida numa lenta.
  it('nao insiste alem de uma vez', async () => {
    const fn = jest.fn(async () => {
      throw Object.assign(new Error('Server has closed the connection.'), { code: 'P1017' });
    });

    await expect(comReconexao(fn)).rejects.toThrow(/closed the connection/);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('erro de pedido sobe na hora, sem segunda tentativa', async () => {
    const fn = jest.fn(async () => {
      throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    });

    await expect(comReconexao(fn)).rejects.toThrow(/Unique constraint/);
    // Repetir aqui poderia gravar duas vezes o que o indice recusou uma.
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
