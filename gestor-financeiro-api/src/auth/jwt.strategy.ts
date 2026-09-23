import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { segredoJwt } from './jwt-secret';

interface JwtPayload {
  sub: string;
  email?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
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
  async validate(payload: JwtPayload) {
    return { id: payload.sub, email: payload.email };
  }
}
