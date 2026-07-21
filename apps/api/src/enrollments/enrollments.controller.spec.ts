import { Test, TestingModule } from '@nestjs/testing';
import { EnrollmentsController } from './enrollments.controller';
import { EnrollmentsService } from './enrollments.service';
import { ActorPayload } from '../common/decorators/get-actor.decorator';

describe('EnrollmentsController', () => {
  let controller: EnrollmentsController;
  let service: EnrollmentsService;

  const mockEnrollmentsService = {
    findAll: jest.fn(),
    create: jest.fn(),
    remove: jest.fn(),
  };

  const actor: ActorPayload = {
    userId: 1,
    tenantId: 1,
    role: 'ADMIN',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EnrollmentsController],
      providers: [
        {
          provide: EnrollmentsService,
          useValue: mockEnrollmentsService,
        },
      ],
    }).compile();

    controller = module.get<EnrollmentsController>(EnrollmentsController);
    service = module.get<EnrollmentsService>(EnrollmentsService);

    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should call service.findAll with correct params', async () => {
      mockEnrollmentsService.findAll.mockResolvedValue([]);
      await controller.findAll(actor, 'test-keyword', '10');

      expect(service.findAll).toHaveBeenCalledWith(1, {
        keyword: 'test-keyword',
        courseId: 10,
      });
    });

    it('should handle undefined keyword and courseId', async () => {
      mockEnrollmentsService.findAll.mockResolvedValue([]);
      await controller.findAll(actor, undefined, undefined);

      expect(service.findAll).toHaveBeenCalledWith(1, {
        keyword: undefined,
        courseId: undefined,
      });
    });
  });

  describe('create', () => {
    it('should call service.create with correct params', async () => {
      const dto = { userId: 2, courseId: 3, roleInCourse: 'STUDENT' };
      mockEnrollmentsService.create.mockResolvedValue({ id: 1, ...dto });

      const result = await controller.create(actor, dto);

      expect(service.create).toHaveBeenCalledWith(1, dto);
      expect(result).toBeDefined();
    });
  });

  describe('remove', () => {
    it('should call service.remove with correct params', async () => {
      mockEnrollmentsService.remove.mockResolvedValue({ id: 100 });

      const result = await controller.remove(actor, 100);

      expect(service.remove).toHaveBeenCalledWith(1, 100);
      expect(result).toBeDefined();
    });
  });
});
