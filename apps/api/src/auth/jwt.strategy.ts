import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        configService.get<string>('JWT_SECRET') ||
        'super-secret-key-change-in-production',
    });
  }

  async validate(payload: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        tenantId: true,
        role: true,
        status: true,
        tenant: {
          select: {
            status: true,
          },
        },
      },
    });

    if (!user || user.status !== 'ACTIVE' || user.tenant.status !== 'ACTIVE') {
      throw new UnauthorizedException(
        'Phiên đăng nhập đã hết hạn hoặc không còn hợp lệ',
      );
    }

    return {
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
    };
  }
}
