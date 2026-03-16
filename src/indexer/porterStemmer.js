/**
 * Porter Stemmer Implementation
 * Implements the Porter stemming algorithm from scratch
 * Reference: Porter, M.F. "An algorithm for suffix stripping."
 */

// Check if character at position is a consonant
function isConsonant(word, i) {
  const ch = word[i];
  if (ch === 'a' || ch === 'e' || ch === 'i' || ch === 'o' || ch === 'u') {
    return false;
  }
  if (ch === 'y') {
    if (i === 0) {
      return true;
    }
    return !isConsonant(word, i - 1);
  }
  return true;
}

// Measure the number of VC (vowel-consonant) sequences
function measure(word) {
  let n = 0;
  let i = 0;
  const len = word.length;
  
  // Skip initial consonants
  while (i < len && isConsonant(word, i)) {
    i++;
  }
  
  // Count VC sequences
  while (i < len) {
    // Skip vowels
    while (i < len && !isConsonant(word, i)) {
      i++;
    }
    // Skip consonants and count
    if (i < len) {
      n++;
      while (i < len && isConsonant(word, i)) {
        i++;
      }
    }
  }
  
  return n;
}

// Check if word contains a vowel
function hasVowel(word) {
  for (let i = 0; i < word.length; i++) {
    if (!isConsonant(word, i)) {
      return true;
    }
  }
  return false;
}

// Check if word ends with double consonant
function endsDoubleConsonant(word) {
  const len = word.length;
  if (len < 2) return false;
  return word[len - 1] === word[len - 2] && isConsonant(word, len - 1);
}

// Check if word ends cvc pattern (consonant-vowel-consonant) 
// where the second consonant is not W, X, or Y
function endsCVC(word) {
  const len = word.length;
  if (len < 3) return false;
  const last = word[len - 1];
  if (last === 'w' || last === 'x' || last === 'y') return false;
  return isConsonant(word, len - 1) && 
         !isConsonant(word, len - 2) && 
         isConsonant(word, len - 3);
}

// Helper: word ends with suffix
function endsWith(word, suffix) {
  return word.endsWith(suffix);
}

// Helper: replace suffix if measure > m
function replaceSuffix(word, oldSuffix, newSuffix, m) {
  const stem = word.slice(0, -oldSuffix.length);
  if (measure(stem) > m) {
    return stem + newSuffix;
  }
  return word;
}

// Step 1a: Plurals and -ed/-ing
function step1a(word) {
  if (word.endsWith('sses')) {
    return word.slice(0, -2);
  }
  if (word.endsWith('ies')) {
    return word.slice(0, -2);
  }
  if (word.endsWith('ss')) {
    return word;
  }
  if (word.endsWith('s')) {
    return word.slice(0, -1);
  }
  return word;
}

// Step 1b: -eed, -ed, -ing
function step1b(word) {
  if (word.endsWith('eed')) {
    const stem = word.slice(0, -3);
    if (measure(stem) > 0) {
      return word.slice(0, -1);
    }
    return word;
  }
  
  let newWord = word;
  let changed = false;
  
  if (word.endsWith('ed')) {
    const stem = word.slice(0, -2);
    if (hasVowel(stem)) {
      newWord = stem;
      changed = true;
    }
  } else if (word.endsWith('ing')) {
    const stem = word.slice(0, -3);
    if (hasVowel(stem)) {
      newWord = stem;
      changed = true;
    }
  }
  
  if (changed) {
    if (newWord.endsWith('at') || newWord.endsWith('bl') || newWord.endsWith('iz')) {
      return newWord + 'e';
    }
    if (endsDoubleConsonant(newWord) && 
        !newWord.endsWith('l') && 
        !newWord.endsWith('s') && 
        !newWord.endsWith('z')) {
      return newWord.slice(0, -1);
    }
    if (measure(newWord) === 1 && endsCVC(newWord)) {
      return newWord + 'e';
    }
    return newWord;
  }
  
  return word;
}

// Step 1c: y -> i if stem has vowel
function step1c(word) {
  if (word.endsWith('y')) {
    const stem = word.slice(0, -1);
    if (hasVowel(stem)) {
      return stem + 'i';
    }
  }
  return word;
}

// Step 2: Double suffixes
function step2(word) {
  const suffixes = {
    'ational': 'ate',
    'tional': 'tion',
    'enci': 'ence',
    'anci': 'ance',
    'izer': 'ize',
    'abli': 'able',
    'alli': 'al',
    'entli': 'ent',
    'eli': 'e',
    'ousli': 'ous',
    'ization': 'ize',
    'ation': 'ate',
    'ator': 'ate',
    'alism': 'al',
    'iveness': 'ive',
    'fulness': 'ful',
    'ousness': 'ous',
    'aliti': 'al',
    'iviti': 'ive',
    'biliti': 'ble'
  };
  
  for (const [suffix, replacement] of Object.entries(suffixes)) {
    if (word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length);
      if (measure(stem) > 0) {
        return stem + replacement;
      }
      return word;
    }
  }
  
  return word;
}

// Step 3: -ic-, -full, -ness etc.
function step3(word) {
  const suffixes = {
    'icate': 'ic',
    'ative': '',
    'alize': 'al',
    'iciti': 'ic',
    'ical': 'ic',
    'ful': '',
    'ness': ''
  };
  
  for (const [suffix, replacement] of Object.entries(suffixes)) {
    if (word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length);
      if (measure(stem) > 0) {
        return stem + replacement;
      }
      return word;
    }
  }
  
  return word;
}

// Step 4: -ant, -ence, etc.
function step4(word) {
  const suffixes = [
    'al', 'ance', 'ence', 'er', 'ic', 'able', 'ible', 'ant',
    'ement', 'ment', 'ent', 'ion', 'ou', 'ism', 'ate', 'iti',
    'ous', 'ive', 'ize'
  ];
  
  for (const suffix of suffixes) {
    if (word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length);
      if (measure(stem) > 1) {
        // Special case for -ion: only remove if preceded by s or t
        if (suffix === 'ion') {
          if (stem.endsWith('s') || stem.endsWith('t')) {
            return stem;
          }
        } else {
          return stem;
        }
      }
      return word;
    }
  }
  
  return word;
}

// Step 5a: Remove final -e if measure > 1 or measure == 1 and not CVC
function step5a(word) {
  if (word.endsWith('e')) {
    const stem = word.slice(0, -1);
    const m = measure(stem);
    if (m > 1) {
      return stem;
    }
    if (m === 1 && !endsCVC(stem)) {
      return stem;
    }
  }
  return word;
}

// Step 5b: Remove trailing double consonant if measure > 1
function step5b(word) {
  if (endsDoubleConsonant(word) && word.endsWith('l') && measure(word) > 1) {
    return word.slice(0, -1);
  }
  return word;
}

/**
 * Main stem function - applies all Porter Stemmer steps
 * @param {string} word - The word to stem
 * @returns {string} - The stemmed word
 */
export function stem(word) {
  if (!word || word.length < 3) {
    return word;
  }
  
  // Convert to lowercase
  word = word.toLowerCase();
  
  // Apply stemming steps in order
  word = step1a(word);
  word = step1b(word);
  word = step1c(word);
  word = step2(word);
  word = step3(word);
  word = step4(word);
  word = step5a(word);
  word = step5b(word);
  
  return word;
}

/**
 * Stem an array of words
 * @param {string[]} words - Array of words to stem
 * @returns {string[]} - Array of stemmed words
 */
export function stemWords(words) {
  return words.map(w => stem(w));
}

export default { stem, stemWords };
