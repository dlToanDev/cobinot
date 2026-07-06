import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Enrollments (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let token: string;
  let adminUser: any;
  let studentUser: any;
  let anotherStudentUser: any;
  let activeCourse: any;
  let closedCourse: any;
  let otherTenantStudent: any;
  let otherTenantCourse: any;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);

    // Let's obtain the logged-in admin user token
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'admin@hxstu.edu.vn',
        password: 'admin123',
      });

    token = loginRes.body.accessToken;
    adminUser = loginRes.body.user;

    // Fetch student and course from seeded data
    studentUser = await prisma.user.findFirst({
      where: { email: 'phong1@gmail.com' },
    });
    anotherStudentUser = await prisma.user.findFirst({
      where: { email: 'phong2@gmail.com' },
    });
    activeCourse = await prisma.course.findFirst({
      where: { courseCode: 'TOEIC450' },
    });

    // Create a closed course for testing validation
    closedCourse = await prisma.course.create({
      data: {
        tenantId: adminUser.tenantId,
        title: 'Khóa học đóng cửa',
        courseCode: 'CLOSED_CRSE',
        status: 'CLOSED',
      },
    });

    // Create another tenant to test isolation
    const otherTenant = await prisma.tenant.create({
      data: { name: 'Tenant Khác', code: 'OTHER_TENANT' },
    });

    otherTenantStudent = await prisma.user.create({
      data: {
        tenantId: otherTenant.id,
        fullName: 'Học Viên Tenant Khác',
        email: 'other@tenant.com',
        role: 'STUDENT',
        status: 'ACTIVE',
      },
    });

    otherTenantCourse = await prisma.course.create({
      data: {
        tenantId: otherTenant.id,
        title: 'Khóa học Tenant Khác',
        courseCode: 'OTHER_CRSE',
        status: 'ACTIVE',
      },
    });
  });

  afterAll(async () => {
    // Cleanup the created resources for E2E
    await prisma.classEnrollment.deleteMany({
      where: {
        userId: {
          in: [studentUser.id, anotherStudentUser.id, otherTenantStudent.id],
        },
      },
    });
    await prisma.userCourse.deleteMany({
      where: {
        userId: {
          in: [studentUser.id, anotherStudentUser.id, otherTenantStudent.id],
        },
      },
    });
    await prisma.course.deleteMany({
      where: {
        id: { in: [closedCourse.id, otherTenantCourse.id] },
      },
    });
    await prisma.user.delete({
      where: { id: otherTenantStudent.id },
    });
    await prisma.tenant.delete({
      where: { code: 'OTHER_TENANT' },
    });

    await app.close();
  });

  describe('POST /enrollments (Create)', () => {
    it('should successfully enroll a student into an active course', async () => {
      const res = await request(app.getHttpServer())
        .post('/enrollments')
        .set('Authorization', `Bearer ${token}`)
        .send({
          userId: studentUser.id,
          courseId: activeCourse.id,
          roleInCourse: 'STUDENT',
        });

      expect(res.status).toBe(201);
      expect(res.body.userId).toBe(studentUser.id);
      expect(res.body.courseId).toBe(activeCourse.id);
      expect(res.body.roleInCourse).toBe('STUDENT');
      expect(res.body.user).toBeDefined();
      expect(res.body.course).toBeDefined();
    });

    it('should throw conflict if student is already enrolled in the course', async () => {
      const res = await request(app.getHttpServer())
        .post('/enrollments')
        .set('Authorization', `Bearer ${token}`)
        .send({
          userId: studentUser.id,
          courseId: activeCourse.id,
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain(
        'Học viên đã tham gia khóa học này từ trước',
      );
    });

    it('should throw bad request if course is closed', async () => {
      const res = await request(app.getHttpServer())
        .post('/enrollments')
        .set('Authorization', `Bearer ${token}`)
        .send({
          userId: anotherStudentUser.id,
          courseId: closedCourse.id,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain(
        'Không thể đăng ký vào khóa học đã đóng/bảo lưu',
      );
    });

    it('should throw not found if student does not belong to the same tenant', async () => {
      const res = await request(app.getHttpServer())
        .post('/enrollments')
        .set('Authorization', `Bearer ${token}`)
        .send({
          userId: otherTenantStudent.id,
          courseId: activeCourse.id,
        });

      expect(res.status).toBe(404);
    });

    it('should throw not found if course does not belong to the same tenant', async () => {
      const res = await request(app.getHttpServer())
        .post('/enrollments')
        .set('Authorization', `Bearer ${token}`)
        .send({
          userId: anotherStudentUser.id,
          courseId: otherTenantCourse.id,
        });

      expect(res.status).toBe(404);
    });
  });

  describe('GET /enrollments (List)', () => {
    it('should return a list of enrollments for the admin tenant', async () => {
      const res = await request(app.getHttpServer())
        .get('/enrollments')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      const enrollment = res.body.find((e: any) => e.userId === studentUser.id);
      expect(enrollment).toBeDefined();
      expect(enrollment.user.id).toBe(studentUser.id);
      expect(enrollment.course.id).toBe(activeCourse.id);
    });

    it('should filter by courseId if courseId query is provided', async () => {
      const res = await request(app.getHttpServer())
        .get('/enrollments')
        .set('Authorization', `Bearer ${token}`)
        .query({ courseId: activeCourse.id });

      expect(res.status).toBe(200);
      expect(res.body.every((e: any) => e.courseId === activeCourse.id)).toBe(
        true,
      );
    });
  });

  describe('DELETE /enrollments/:id', () => {
    it('should successfully remove student from course by enrollment ID', async () => {
      const listRes = await request(app.getHttpServer())
        .get('/enrollments')
        .set('Authorization', `Bearer ${token}`)
        .query({ courseId: activeCourse.id });

      const enrollment = listRes.body.find(
        (e: any) => e.userId === studentUser.id,
      );
      expect(enrollment).toBeDefined();

      const deleteRes = await request(app.getHttpServer())
        .delete(`/enrollments/${enrollment.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.id).toBe(enrollment.id);
    });

    it('should throw not found if enrollment ID does not exist', async () => {
      const deleteRes = await request(app.getHttpServer())
        .delete('/enrollments/999999')
        .set('Authorization', `Bearer ${token}`);

      expect(deleteRes.status).toBe(404);
    });
  });

  describe('DELETE /students/:studentId/courses/:courseId', () => {
    it('should successfully remove student from course by student and course ID', async () => {
      // Re-enroll another student to test deletion by student and course ID
      await request(app.getHttpServer())
        .post('/enrollments')
        .set('Authorization', `Bearer ${token}`)
        .send({
          userId: anotherStudentUser.id,
          courseId: activeCourse.id,
        });

      const deleteRes = await request(app.getHttpServer())
        .delete(`/students/${anotherStudentUser.id}/courses/${activeCourse.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(deleteRes.status).toBe(200);
    });

    it('should throw not found if student is not registered in the course', async () => {
      const deleteRes = await request(app.getHttpServer())
        .delete(`/students/${anotherStudentUser.id}/courses/${activeCourse.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(deleteRes.status).toBe(404);
    });
  });
});
