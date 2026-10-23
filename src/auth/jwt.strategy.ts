import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { User, UserDoc } from '../db/schemas';
import { AuthUser, JwtPayload } from './auth.types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @InjectModel(User.name) private readonly users: Model<UserDoc>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.jwtAccessSecret,
      ignoreExpiration: false,
      algorithms: ['HS256'],
    });
  }

  /** Loads the user on every request so deleted accounts and role changes apply immediately. */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.users.findById(payload.sub).select('email role emailVerifiedAt').lean();
    if (!user) throw new UnauthorizedException();
    return { id: String(user._id), email: user.email, role: user.role, emailVerified: !!user.emailVerifiedAt };
  }
}
