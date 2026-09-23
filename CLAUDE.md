# Gestor Financeiro

## Design

Toda tela, componente ou ajuste visual deste projeto segue o padrão definido em
[DESIGN.md](DESIGN.md). Leia esse arquivo antes de escrever qualquer CSS ou
markup de interface e use os tokens, a anatomia de componentes e as regras de
composição que estão lá — não crie um estilo novo.

## Backend

`gestor-financeiro-api/` — NestJS + Prisma + PostgreSQL. `npm test` roda os
testes (Jest). `npm run start:dev` sobe a API em watch mode.
