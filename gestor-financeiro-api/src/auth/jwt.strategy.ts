import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { segredoJwt } from './jwt-secret';

interface JwtPayload {
  sub: string;
  email?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Mesma fonte do JwtModule: assinar com um segredo e conferir com outro
      // derrubaria todo login. E nunca um valor padrão conhecido.
      secretOrKey: segredoJwt(),
      algorithms: ['HS256'],
    });
  }

  // O retorno aqui vira `req.user` — os controllers esperam `req.user.id`.
  //
  // A assinatura ser válida não basta: ela diz que o token foi emitido por
  // nós, não que a pessoa ainda existe. Quem apaga a conta e tem outro
  // aparelho logado continuaria usando o app por até 15 minutos (o fôlego do
  // token de acesso) — vendo uma conta vazia, mas dentro. Para um recurso que
  // existe para dar fim aos dados, "apagado mas ainda entrando" é a resposta
  // errada.
  //
  // Custa uma busca por chave primária em cada pedido autenticado, e vale
  // também para qualquer conta que venha a ser suspensa. `users` é uma das
  // três tabelas sem RLS, então a consulta roda sem contexto de dono.
  async validate(payload: JwtPayload) {
    const existe = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true },
    });
    if (!existe) throw new UnauthorizedException('Esta conta não existe mais.');
    return { id: payload.sub, email: payload.email };
  }
}
