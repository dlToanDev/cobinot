import {
  normalizeGmail,
  normalizeEmail,
  normalizeTitleCase,
  normalizeLocation,
  normalizeSlugCode,
  normalizePhone,
  levenshteinDistance,
  isCloseToGmail,
} from './normalization';

describe('Normalization Utilities', () => {
  describe('levenshteinDistance', () => {
    it('should calculate correct distance', () => {
      expect(levenshteinDistance('gmai', 'gmail')).toBe(1);
      expect(levenshteinDistance('gamil', 'gmail')).toBe(2);
      expect(levenshteinDistance('gmail', 'gmail')).toBe(0);
      expect(levenshteinDistance('abc', 'xyz')).toBe(3);
    });
  });

  describe('isCloseToGmail', () => {
    it('should detect words close to gmail', () => {
      expect(isCloseToGmail('gmai')).toBe(true);
      expect(isCloseToGmail('gamil')).toBe(true);
      expect(isCloseToGmail('gmaill')).toBe(true);
      expect(isCloseToGmail('gmeil')).toBe(true);
      expect(isCloseToGmail('gmail')).toBe(true);
    });

    it('should not detect common non-gmail words starting with g', () => {
      expect(isCloseToGmail('goal')).toBe(false);
      expect(isCloseToGmail('girl')).toBe(false);
      expect(isCloseToGmail('game')).toBe(false);
    });
  });

  describe('normalizeGmail', () => {
    it('should correct gmail spelling in text and email addresses', () => {
      expect(normalizeGmail('toan123@gmai.com')).toBe('toan123@gmail.com');
      expect(normalizeGmail('toan123@gamil.com')).toBe('toan123@gmail.com');
      expect(normalizeGmail('Tài khoản Gmai của tôi')).toBe('Tài khoản Gmail của tôi');
      expect(normalizeGmail('Gamil là dịch vụ email')).toBe('Gmail là dịch vụ email');
    });
  });

  describe('normalizeEmail', () => {
    it('should lower case emails and correct gmail typos', () => {
      expect(normalizeEmail('ToanToan123@GMAI.COM')).toBe('toantoan123@gmail.com');
      expect(normalizeEmail('myemail@gamil.com')).toBe('myemail@gmail.com');
      expect(normalizeEmail('other@yahoo.com')).toBe('other@yahoo.com');
    });
  });

  describe('normalizeTitleCase', () => {
    it('should title case names, courses, and classes', () => {
      expect(normalizeTitleCase('hoàng anh toàn')).toBe('Hoàng Anh Toàn');
      expect(normalizeTitleCase('kHóa Học Toeic450+')).toBe('Khóa Học Toeic450+');
      expect(normalizeTitleCase('lớp cơ bản 1')).toBe('Lớp Cơ Bản 1');
      expect(normalizeTitleCase('  nGuYễN   vĂn   aNh ')).toBe('Nguyễn Văn Anh');
    });
  });

  describe('normalizeLocation', () => {
    it('should upper case geographic locations and addresses', () => {
      expect(normalizeLocation('nam định')).toBe('NAM ĐỊNH');
      expect(normalizeLocation('hà nội')).toBe('HÀ NỘI');
      expect(normalizeLocation('Bắc Ninh')).toBe('BẮC NINH');
    });
  });

  describe('normalizeSlugCode', () => {
    it('should create lower snake case codes from Vietnamese class names', () => {
      expect(normalizeSlugCode('Tiếng Bỉ 2')).toBe('tieng_bi_2');
      expect(normalizeSlugCode('  Lớp   IELTS c2  ')).toBe('lop_ielts_c2');
    });
  });

  describe('normalizePhone', () => {
    it('should format phone numbers into exactly 10 digits', () => {
      expect(normalizePhone('0978.636.933')).toBe('0978636933');
      expect(normalizePhone('0978 636 933')).toBe('0978636933');
      expect(normalizePhone('+84978636933')).toBe('0978636933');
      expect(normalizePhone('84978636933')).toBe('0978636933');
      expect(normalizePhone('978636933')).toBe('0978636933');
    });
  });
});
