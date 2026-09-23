import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService, SessaoEmitida } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import {
  COOKIE_SESSAO,
  apagarCookieSessao,
  clienteWeb,
  gravarCookieSessao,
  lerCookie,
} from './session-cookie';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Navegador: refresh token vai para cookie httpOnly e SAI do corpo, para
   * o JavaScript da página nunca tê-lo em mãos. Outros clientes: no corpo. */
  private entregar(req: Request, res: Response, sessao: SessaoEmitida) {
    if (!clienteWeb(req)) return sessao;
    gravarCookieSessao(res, sessao.refreshToken);
    const { refreshToken: _fora, ...semToken } = sessao;
    return semToken;
  }

  private tokenDaSessao(req: Request, dto: RefreshDto): string | undefined {
    return dto?.refreshToken || lerCookie(req, COOKIE_SESSAO);
  }

  @Post('register')
  async register(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() dto: RegisterDto) {
    return this.entregar(req, res, await this.auth.register(dto));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() dto: LoginDto) {
    return this.entregar(req, res, await this.auth.login(dto));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() dto: RefreshDto) {
    const token = this.tokenDaSessao(req, dto);
    if (!token) throw new UnauthorizedException('Sessão expirada. Entre de novo.');
    try {
      return this.entregar(req, res, await this.auth.refresh(token));
    } catch (erro) {
      // Sessão que não vale mais não deve ficar voltando a cada requisição.
      apagarCookieSessao(res);
      throw erro;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() dto: RefreshDto) {
    const token = this.tokenDaSessao(req, dto);
    if (token) await this.auth.logout(token);
    apagarCookieSessao(res);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: any) {
    return this.auth.me(req.user.id);
  }

  // 204 sempre, exista o e-mail ou não — ver AuthService.forgotPassword.
  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.newPassword);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async changePassword(
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.entregar(req, res, await this.auth.changePassword(req.user.id, dto.currentPassword, dto.newPassword));
  }
}
