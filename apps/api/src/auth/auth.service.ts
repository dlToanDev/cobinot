import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    const user = await this.prisma.user.findFirst({
      where: {
        email: email,
      },
    });

    if (!user) {
      throw new UnauthorizedException(
        'Tài khoản hoặc mật khẩu không chính xác',
      );
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException(
        'Tài khoản đã bị khóa hoặc không hoạt động',
      );
    }

    if (user.role !== 'ADMIN') {
      throw new UnauthorizedException(
        'Chỉ tài khoản Quản trị viên mới có quyền đăng nhập',
      );
    }

    // Compare passwords if password hash exists
    if (user.password) {
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        throw new UnauthorizedException(
          'Tài khoản hoặc mật khẩu không chính xác',
        );
      }
    } else {
      throw new UnauthorizedException('Tài khoản chưa thiết lập mật khẩu');
    }

    const payload = {
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
      },
    };
  }
}
