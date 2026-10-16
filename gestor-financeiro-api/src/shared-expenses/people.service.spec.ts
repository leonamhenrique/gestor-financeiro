// ============================================================
// people.service.spec.ts
// ============================================================

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PeopleService } from './people.service';
import { PrismaService } from '../prisma/prisma.service';

describe('PeopleService', () => {
  let service: PeopleService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      person: {
        create: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      expenseShare: { count: jest.fn().mockResolvedValue(0) },
      sharedExpense: { count: jest.fn().mockResolvedValue(0) },
      settlement: { count: jest.fn().mockResolvedValue(0) },
      shareLink: { count: jest.fn().mockResolvedValue(0) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PeopleService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(PeopleService);
  });

  it('create() tira espaço do nome e guarda a posição no fim da lista', async () => {
    prisma.person.count.mockResolvedValue(3);
    prisma.person.create.mockResolvedValue({ id: 'p1' });

    await service.create({ userId: 'u1', name: '  Rafael  ' });

    expect(prisma.person.create).toHaveBeenCalledWith({
      data: { userId: 'u1', name: 'Rafael', pixKey: null, sortOrder: 3 },
    });
  });

  it('create() trata chave Pix em branco como ausente', async () => {
    prisma.person.create.mockResolvedValue({ id: 'p1' });

    await service.create({ userId: 'u1', name: 'Bruna', pixKey: '   ' });

    expect(prisma.person.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ pixKey: null }),
    });
  });

  it('list() esconde as arquivadas por padrão', async () => {
    await service.findAllByUser('u1');
    expect(prisma.person.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', isActive: true } }),
    );
  });

  it('list() mostra as arquivadas quando pedem', async () => {
    await service.findAllByUser('u1', true);
    expect(prisma.person.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', isActive: undefined } }),
    );
  });

  // A posse é conferida, não presumida: o id vem de fora.
  it('pessoa de outro dono não existe para mim', async () => {
    prisma.person.findFirst.mockResolvedValue(null);
    await expect(service.minha('u1', 'p-de-outro')).rejects.toThrow(NotFoundException);
    expect(prisma.person.findFirst).toHaveBeenCalledWith({
      where: { id: 'p-de-outro', userId: 'u1' },
    });
  });

  it('delete() apaga de verdade quem nunca participou de nada', async () => {
    prisma.person.findFirst.mockResolvedValue({ id: 'p1', userId: 'u1' });

    const r = await service.delete('u1', 'p1');

    expect(r).toEqual({ deleted: true, archived: false });
    expect(prisma.person.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
  });

  // Cada vínculo sozinho já basta para arquivar: as chaves estrangeiras são
  // Restrict, e sem a contagem o usuário tomaria erro cru do banco.
  it.each([
    ['parte em despesa', 'expenseShare'],
    ['despesa paga por ela', 'sharedExpense'],
    ['acerto', 'settlement'],
    ['link de compartilhamento ativo', 'shareLink'],
  ])('delete() arquiva quem tem %s', async (_rotulo, modelo) => {
    prisma.person.findFirst.mockResolvedValue({ id: 'p1', userId: 'u1' });
    prisma[modelo].count.mockResolvedValue(1);

    const r = await service.delete('u1', 'p1');

    expect(r).toEqual({ deleted: false, archived: true });
    expect(prisma.person.delete).not.toHaveBeenCalled();
    expect(prisma.person.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { isActive: false },
    });
  });

  it('reorder() põe os enviados na frente e mantém o resto atrás', async () => {
    prisma.person.findMany.mockResolvedValue([
      { id: 'a', sortOrder: 0 },
      { id: 'b', sortOrder: 1 },
      { id: 'c', sortOrder: 2 },
    ]);

    await service.reorder('u1', ['c', 'a']);

    const gravados = prisma.person.update.mock.calls.map((c: any[]) => [
      c[0].where.id,
      c[0].data.sortOrder,
    ]);
    expect(gravados).toEqual([
      ['c', 0],
      ['a', 1],
      ['b', 2],
    ]);
  });
});
