import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting backfill of courses and enrollments...');

  // 1. Fetch all courses
  const courses = await prisma.course.findMany();
  console.log(`Found ${courses.length} courses to process.`);

  let createdClassesCount = 0;
  let createdEnrollmentsCount = 0;

  for (const course of courses) {
    const classCode = `${course.courseCode}-DEFAULT`;

    // Check if the default class already exists for this tenant
    let defaultClass = await prisma.courseClass.findFirst({
      where: {
        tenantId: course.tenantId,
        classCode: classCode,
      },
    });

    if (!defaultClass) {
      defaultClass = await prisma.courseClass.create({
        data: {
          tenantId: course.tenantId,
          courseId: course.id,
          classCode: classCode,
          title: `${course.title} - Lớp mặc định`,
          type: 'WEEKLY',
          description: `Lớp học mặc định được tạo tự động từ khóa học ${course.title}`,
          status: 'ACTIVE',
        },
      });
      createdClassesCount++;
      console.log(`Created default class [${classCode}] for course [${course.title}]`);
    } else {
      console.log(`Default class [${classCode}] already exists for course [${course.title}]`);
    }

    // 2. Fetch all legacy enrollments for this course
    const legacyEnrollments = await prisma.userCourse.findMany({
      where: {
        courseId: course.id,
      },
    });

    for (const legacy of legacyEnrollments) {
      // Check if enrollment already exists in ClassEnrollment
      const existingEnrollment = await prisma.classEnrollment.findUnique({
        where: {
          uq_user_class: {
            userId: legacy.userId,
            classId: defaultClass.id,
          },
        },
      });

      if (!existingEnrollment) {
        // Map roleInCourse to roleInClass
        let roleInClass = 'STUDENT';
        if (legacy.roleInCourse === 'TEACHER') {
          roleInClass = 'TEACHER';
        }

        await prisma.classEnrollment.create({
          data: {
            userId: legacy.userId,
            classId: defaultClass.id,
            roleInClass: roleInClass,
            joinedAt: legacy.joinedAt,
            endedAt: legacy.endedAt,
            status: 'ACTIVE',
            createdAt: legacy.createdAt,
          },
        });
        createdEnrollmentsCount++;
      }
    }
  }

  console.log(`Backfill completed successfully!`);
  console.log(`Created classes: ${createdClassesCount}`);
  console.log(`Created enrollments: ${createdEnrollmentsCount}`);
}

main()
  .catch((e) => {
    console.error('Error during backfill:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
