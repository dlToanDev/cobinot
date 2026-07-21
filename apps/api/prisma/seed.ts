import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  // Clear existing data in reverse order of dependencies
  await prisma.aiCopilotTurnEvent.deleteMany({});
  await prisma.aiAgentAction.deleteMany({});
  await prisma.aiAgentSessionMessage.deleteMany({});
  await prisma.aiAgentSession.deleteMany({});
  await prisma.aiAgentAuditLog.deleteMany({});
  await prisma.userCourse.deleteMany({});
  await prisma.course.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.tenant.deleteMany({});

  console.log('Cleared existing database data.');

  // 1. Create a sample tenant
  const tenant = await prisma.tenant.create({
    data: {
      name: 'Trung Tâm Ngoại Ngữ DLT',
      code: 'DLT_CENTER',
      status: 'ACTIVE',
    },
  });
  console.log(`Created tenant: ${tenant.name}`);

  // 2. Hash Password for Admin
  const adminPasswordHash = await bcrypt.hash('admin123', 10);

  // 3. Create active Admin
  const admin = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      fullName: 'ToanXiuuu',
      email: 'xiuuu@hxstu.com.vn',
      phone: '0988888888',
      password: adminPasswordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });
  console.log(`Created admin user: ${admin.email}`);

  // 4. Create Students (with duplicate names to test candidate resolution/selection later)
  const studentsData = [
    { fullName: 'Nguyễn Văn Phong', email: 'phong1@gmail.com', phone: '0911111111' },
    { fullName: 'Nguyễn Văn Phong', email: 'phong2@gmail.com', phone: '0922222222' }, // Trùng tên để test
    { fullName: 'Trần Thị Lan', email: 'lan@gmail.com', phone: '0933333333' },
    { fullName: 'Lê Văn Hùng', email: 'hung@gmail.com', phone: '0944444444' },
    { fullName: 'Phạm Minh Tuấn', email: 'tuan@gmail.com', phone: '0955555555' },
    { fullName: 'Hoàng Thị Mai', email: 'mai@gmail.com', phone: '0966666666' },
  ];

  for (const s of studentsData) {
    const student = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        fullName: s.fullName,
        email: s.email,
        phone: s.phone,
        role: 'STUDENT',
        status: 'ACTIVE',
      },
    });
    console.log(`Created student: ${student.fullName} (${student.email})`);
  }

  // 5. Create Courses (with overlapping keywords)
  const coursesData = [
    { title: 'Luyện thi TOEIC 450+', code: 'TOEIC450', description: 'Khóa học TOEIC nền tảng cho người mới bắt đầu' },
    { title: 'Luyện thi TOEIC 650+', code: 'TOEIC650', description: 'Khóa học TOEIC bứt phá mục tiêu điểm số' },
    { title: 'IELTS Foundation 5.0', code: 'IELTS_FND', description: 'Xây dựng nền tảng IELTS cơ bản' },
    { title: 'IELTS Intensive 6.5', code: 'IELTS_INT', description: 'Luyện thi IELTS cường độ cao' },
    { title: 'Tiếng Anh Giao Tiếp Cơ Bản', code: 'COM_BASIC', description: 'Giao tiếp hàng ngày cơ bản' },
  ];

  for (const c of coursesData) {
    const course = await prisma.course.create({
      data: {
        tenantId: tenant.id,
        title: c.title,
        courseCode: c.code,
        status: 'ACTIVE',
      },
    });
    console.log(`Created course: ${course.title} [${course.courseCode}]`);
  }

  console.log('Database seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('Error during database seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
