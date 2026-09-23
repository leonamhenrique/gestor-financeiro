import { BadRequestException, NotFoundException } from '@nestjs/common';
import { gravarOrdem, novaOrdem } from './ordering';

const lista = (...ids: string[]) => ids.map((id, i) => ({ id, sortOrder: i }));

describe('novaOrdem', () => {
  it('enviados na frente, na ordem enviada; o resto atrás na ordem de antes', () => {
    expect(novaOrdem(['d', 'b'], lista('a', 'b', 'c', 'd'))).toEqual(['d', 'b', 'a', 'c']);
  });

  it('lista completa vira exatamente a enviada', () => {
    expect(novaOrdem(['c', 'a', 'b'], lista('a', 'b', 'c'))).toEqual(['c', 'a', 'b']);
  });

  it('recusa repetidos e ids que não são da lista', () => {
    expect(() => novaOrdem(['a', 'a'], lista('a', 'b'))).toThrow(BadRequestException);
    expect(() => novaOrdem(['x'], lista('a', 'b'))).toThrow(NotFoundException);
  });
});

describe('gravarOrdem', () => {
  it('só grava quem mudou de posição', async () => {
    const gravar = jest.fn(async () => undefined);
    await gravarOrdem(['a', 'c', 'b'], lista('a', 'b', 'c'), gravar);
    expect(gravar.mock.calls).toEqual([
      ['c', 1],
      ['b', 2],
    ]);
  });

  it('empates antigos (tudo 0) viram posições distintas', async () => {
    const gravar = jest.fn(async () => undefined);
    await gravarOrdem(['b', 'a'], [{ id: 'a', sortOrder: 0 }, { id: 'b', sortOrder: 0 }], gravar);
    expect(gravar.mock.calls).toEqual([['a', 1]]);
  });
});
