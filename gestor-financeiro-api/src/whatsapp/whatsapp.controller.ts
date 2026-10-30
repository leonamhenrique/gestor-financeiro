// ============================================================
// whatsapp.controller.ts
// ============================================================
// As três portas da tela: ver o vínculo, criar um código, desligar.
//
// O webhook NÃO está aqui. Ele é público por natureza — quem chama é a Meta,
// sem token de usuário — e vai nascer com a sua própria rota, com verificação
// de assinatura, quando houver número para falar com ela.
// ============================================================

import { Controller, Delete, Get, HttpCode, Post, Req } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';

@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsapp: WhatsappService) {}

  @Get()
  status(@Req() req: any) {
    return this.whatsapp.status(req.user.id);
  }

  // POST, e não GET: cada chamada cria um código novo e mata o anterior.
  @Post('pairing')
  @HttpCode(201)
  parear(@Req() req: any) {
    return this.whatsapp.criarPareamento(req.user.id);
  }

  @Delete()
  desvincular(@Req() req: any) {
    return this.whatsapp.desvincular(req.user.id);
  }
}
