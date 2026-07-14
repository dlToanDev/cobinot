-- AlterTable
ALTER TABLE "class_enrollments" ADD COLUMN     "expire_date" TIMESTAMP(3),
ADD COLUMN     "allow_late_payment" BOOLEAN,
ADD COLUMN     "note" TEXT;
