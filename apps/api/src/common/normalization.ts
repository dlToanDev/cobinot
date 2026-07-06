// Levenshtein distance implementation for finding words close to gmail
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          Math.min(
            matrix[i][j - 1] + 1, // insertion
            matrix[i - 1][j] + 1 // deletion
          )
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

const GMAIL_TYPOS = new Set([
  'gmai', 'gamil', 'gmial', 'gmaill', 'gmeil', 'gmeo', 'gmel', 'gmaul', 
  'gmaiil', 'gma', 'gml', 'gimail', 'gmali', 'gmaili', 'gmam', 'gmaim'
]);

const COMMON_NON_GMAIL_G_WORDS = new Set([
  'goal', 'girl', 'game', 'good', 'gold', 'golf', 'gym', 'gum', 'gale',
  'gilt', 'gill', 'gird', 'grim', 'grow', 'germ', 'give', 'gate', 'glad'
]);

export function isCloseToGmail(word: string): boolean {
  const w = word.toLowerCase();
  if (w === 'gmail') return true;
  if (GMAIL_TYPOS.has(w)) return true;
  if (COMMON_NON_GMAIL_G_WORDS.has(w)) return false;
  
  if (w.startsWith('g') && w.length >= 3 && w.length <= 7) {
    const dist = levenshteinDistance(w, 'gmail');
    return dist <= 2;
  }
  return false;
}

// "mấy chữ gần giống gmail thì chuẩn thành gmail"
export function normalizeGmail(text: string): string {
  if (!text) return '';
  // First, find and normalize emails
  let normalized = text.replace(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, (email) => {
    return normalizeEmail(email);
  });
  
  // Then, normalize standalone words close to gmail
  normalized = normalized.replace(/\b([a-zA-Z]{3,7})\b/g, (match) => {
    if (isCloseToGmail(match)) {
      const lower = match.toLowerCase();
      if (lower === 'gmail') return match;
      if (match === match.toUpperCase()) return 'GMAIL';
      if (match.charAt(0) === match.charAt(0).toUpperCase()) return 'Gmail';
      return 'gmail';
    }
    return match;
  });
  
  return normalized;
}

// "email thì không được viết hoa gì" & "mấy chữ gần giống gmail..."
export function normalizeEmail(email: string): string {
  if (!email) return '';
  let normalized = email.trim().toLowerCase();
  
  normalized = normalized.replace(/@([a-z0-9.-]+)/gi, (match, domain) => {
    const parts = domain.split('.');
    if (parts.length > 0) {
      const mainDomain = parts[0];
      if (isCloseToGmail(mainDomain)) {
        parts[0] = 'gmail';
      }
    }
    return '@' + parts.join('.');
  });
  return normalized;
}

// "tên ng , tên khóa học, tên lớp thì viết hoa chứ đâu" -> Title Case
export function normalizeTitleCase(value: string): string {
  if (!value) return '';
  return value
    .trim()
    .split(/\s+/)
    .map((word) => {
      if (!word) return '';
      const match = word.match(/\p{L}/u);
      if (match && match.index !== undefined) {
        const idx = match.index;
        return (
          word.slice(0, idx).toLowerCase() +
          word.charAt(idx).toUpperCase() +
          word.slice(idx + 1).toLowerCase()
        );
      }
      return word.toLowerCase();
    })
    .join(' ');
}

// "tên địa danh thì viết hoa hết" -> Uppercase
export function normalizeLocation(value: string): string {
  if (!value) return '';
  return value.trim().toLocaleUpperCase('vi-VN');
}

export function normalizeSlugCode(value: string): string {
  if (!value) return '';
  return value
    .trim()
    .toLocaleLowerCase('vi-VN')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

// "sđt thì 10 số"
export function normalizePhone(phone: string): string {
  if (!phone) return '';
  let digits = phone.replace(/\D/g, '');
  
  if (digits.startsWith('84') && digits.length > 10) {
    digits = '0' + digits.slice(2);
  }
  
  if (digits.length === 10) {
    return digits;
  }
  
  if (digits.length === 9 && !digits.startsWith('0')) {
    return '0' + digits;
  }
  
  return digits;
}
