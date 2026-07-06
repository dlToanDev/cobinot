import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const mockConfigService = {
    get: jest.fn().mockReturnValue('test-secret'),
  } as unknown as ConfigService;

  const mockUserDelegate = {
    findUnique: jest.fn(),
  };

  const mockPrismaService = {
    user: mockUserDelegate,
  } as unknown as PrismaService;

  let strategy: JwtStrategy;

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new JwtStrategy(mockConfigService, mockPrismaService);
  });

  it('should load the actor from the database and ignore stale tenant data in the token', async () => {
    mockUserDelegate.findUnique.mockResolvedValue({
      id: 1,
      tenantId: 7,
      role: 'ADMIN',
      status: 'ACTIVE',
      tenant: {
        status: 'ACTIVE',
      },
    });

    await expect(
      strategy.validate({ userId: 1, tenantId: 2, role: 'ADMIN' }),
    ).resolves.toEqual({
      userId: 1,
      tenantId: 7,
      role: 'ADMIN',
    });

    expect(mockUserDelegate.findUnique).toHaveBeenCalledWith({
      where: { id: 1 },
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
  });

  it('should reject a token when the user no longer exists', async () => {
    mockUserDelegate.findUnique.mockResolvedValue(null);

    await expect(
      strategy.validate({ userId: 999, tenantId: 1, role: 'ADMIN' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('should reject a token when the tenant is inactive', async () => {
    mockUserDelegate.findUnique.mockResolvedValue({
      id: 1,
      tenantId: 1,
      role: 'ADMIN',
      status: 'ACTIVE',
      tenant: {
        status: 'INACTIVE',
      },
    });

    await expect(
      strategy.validate({ userId: 1, tenantId: 1, role: 'ADMIN' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
