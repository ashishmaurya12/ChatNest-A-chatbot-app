const User = require('../models/User');

/**
 * ChatNest AI — Smart Memory Extraction Service
 * Extracts personal facts from user messages and saves to permanent DB memory.
 * Supports English, Hindi, and Hinglish patterns.
 */
async function extractAndSaveMemory(userId, text) {
  if (!userId || !text) return;

  const cleanText = text.trim();
  const lower = cleanText.toLowerCase();

  const factsToSave = [];

  // ──────────────────────────────────────────────
  // 1. Explicit Remember / Memorize Requests
  // ──────────────────────────────────────────────
  const explicitPatterns = [
    /(?:memorise|memorize|remember|save|note|yaad rakhna|yaad rakho|note kar|save kar)(?:\s+this|\s+that)?[:\s]+(.+)/i,
    /(?:don['']t forget)[:\s]+(.+)/i,
  ];
  for (const pat of explicitPatterns) {
    const m = cleanText.match(pat);
    if (m && m[1] && m[1].length > 2) {
      factsToSave.push(m[1].trim());
    }
  }

  // ──────────────────────────────────────────────
  // 2. Name — English & Hinglish
  // ──────────────────────────────────────────────
  const namePatterns = [
    /(?:my name is|i am called|call me|mera naam|mujhe|mera name is)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i,
    /(?:i am|i'm)\s+([A-Z][a-z]+)(?:\s*,|\s+and\s|\s+from)/,
  ];
  for (const pat of namePatterns) {
    const m = cleanText.match(pat);
    if (m && m[1]) {
      const name = m[1].trim();
      const skip = ['a', 'the', 'an', 'going', 'doing', 'here', 'good', 'fine', 'okay', 'well', 'student'];
      if (!skip.includes(name.toLowerCase()) && name.length > 1) {
        factsToSave.push(`User's name is ${name.charAt(0).toUpperCase() + name.slice(1)}`);
      }
    }
  }

  // ──────────────────────────────────────────────
  // 3. Age — English & Hinglish
  // ──────────────────────────────────────────────
  const agePatterns = [
    /(?:i am|i'm|meri umar|meri age)\s+(\d{1,2})\s*(?:years?\s*old|saal\s*ka|saal\s*ki)?/i,
    /my age is\s+(\d{1,2})/i,
  ];
  for (const pat of agePatterns) {
    const m = cleanText.match(pat);
    if (m && m[1]) {
      const age = parseInt(m[1]);
      if (age >= 5 && age <= 100) {
        factsToSave.push(`User's age is ${age} years old`);
      }
    }
  }

  // ──────────────────────────────────────────────
  // 4. Location / City — English & Hinglish
  // ──────────────────────────────────────────────
  const locationPatterns = [
    /(?:i live in|i am from|i'm from|i stay in|main rehta hoon|main reh raha hoon|mera ghar|meri city)\s+([a-zA-Z\s]+?)(?:\.|,|$)/i,
    /(?:based in|located in|residing in)\s+([a-zA-Z\s]+?)(?:\.|,|$)/i,
  ];
  for (const pat of locationPatterns) {
    const m = cleanText.match(pat);
    if (m && m[1] && m[1].trim().length > 2) {
      factsToSave.push(`User lives in ${m[1].trim()}`);
    }
  }

  // ──────────────────────────────────────────────
  // 5. Profession / Job / Role
  // ──────────────────────────────────────────────
  const professionPatterns = [
    /(?:i am a|i'm a|i work as(?: a)?|i am an|i'm an|main ek|mera profession|meri job)\s+([a-zA-Z\s]+?)(?:\.|,|$)/i,
    /(?:i work at|i work for)\s+([a-zA-Z\s]+?)(?:\.|,|$)/i,
  ];
  for (const pat of professionPatterns) {
    const m = cleanText.match(pat);
    if (m && m[1]) {
      const role = m[1].trim();
      const skip = ['good', 'bad', 'fine', 'okay', 'going', 'here', 'home'];
      if (!skip.includes(role.toLowerCase()) && role.length > 3) {
        factsToSave.push(`User's profession/role: ${role}`);
      }
    }
  }

  // ──────────────────────────────────────────────
  // 6. Education
  // ──────────────────────────────────────────────
  const educationPatterns = [
    /(?:i(?:'m| am) (?:studying|pursuing|doing)|i study)\s+([a-zA-Z\s]+?)(?:\.|,|$)/i,
    /(?:i(?:'m| am) a student of|meri field)\s+([a-zA-Z\s]+?)(?:\.|,|$)/i,
    /(?:i graduated from|i passed out from|mera college)\s+([a-zA-Z\s]+?)(?:\.|,|$)/i,
  ];
  for (const pat of educationPatterns) {
    const m = cleanText.match(pat);
    if (m && m[1] && m[1].trim().length > 3) {
      factsToSave.push(`User is studying/educated in: ${m[1].trim()}`);
    }
  }

  // ──────────────────────────────────────────────
  // 7. Hobbies & Interests
  // ──────────────────────────────────────────────
  const hobbyPatterns = [
    /(?:i love|i like|i enjoy|i'm into|i am into|mujhe pasand|mujhe accha lagta)\s+([a-zA-Z\s,]+?)(?:\.|,|$)/i,
    /(?:my hobby is|my hobbies are|mera hobby)\s+([a-zA-Z\s,]+?)(?:\.|,|$)/i,
    /(?:i'm passionate about|i am passionate about)\s+([a-zA-Z\s]+?)(?:\.|,|$)/i,
  ];
  for (const pat of hobbyPatterns) {
    const m = cleanText.match(pat);
    if (m && m[1] && m[1].trim().length > 3) {
      const interest = m[1].trim();
      const skip = ['you', 'it', 'this', 'that', 'him', 'her', 'them'];
      if (!skip.includes(interest.toLowerCase())) {
        factsToSave.push(`User's interest/hobby: ${interest}`);
      }
    }
  }

  // ──────────────────────────────────────────────
  // 8. Favorite Things
  // ──────────────────────────────────────────────
  const favPattern = /(?:my (?:favorite|favourite)|mera favorite|meri favourite)\s+([a-zA-Z\s]+?)\s+is\s+([a-zA-Z0-9\s.]+?)(?:\.|,|$)/i;
  const favM = cleanText.match(favPattern);
  if (favM && favM[1] && favM[2]) {
    factsToSave.push(`User's favorite ${favM[1].trim()}: ${favM[2].trim()}`);
  }

  // ──────────────────────────────────────────────
  // 9. Goals / Dreams
  // ──────────────────────────────────────────────
  const goalPatterns = [
    /(?:my goal is|my dream is|i want to become|i want to be|mera sapna|mera goal)\s+([a-zA-Z\s]+?)(?:\.|,|$)/i,
    /(?:i'm trying to|i am trying to|main karna chahta hoon)\s+([a-zA-Z\s]+?)(?:\.|,|$)/i,
  ];
  for (const pat of goalPatterns) {
    const m = cleanText.match(pat);
    if (m && m[1] && m[1].trim().length > 5) {
      factsToSave.push(`User's goal/dream: ${m[1].trim()}`);
    }
  }

  // ──────────────────────────────────────────────
  // 10. Language Preference
  // ──────────────────────────────────────────────
  const langPattern = /(?:please (?:reply|respond|answer)|talk to me|speak to me|baat karo|jawab do)\s+(?:in|me|mein)\s+([a-zA-Z]+)/i;
  const langM = cleanText.match(langPattern);
  if (langM && langM[1]) {
    factsToSave.push(`User prefers responses in: ${langM[1].trim()}`);
  }

  // ──────────────────────────────────────────────
  // 11. Relationships
  // ──────────────────────────────────────────────
  const relPatterns = [
    /my (?:wife|husband|girlfriend|boyfriend|partner|spouse) (?:is|name is)\s+([a-zA-Z]+)/i,
    /i have\s+(\d+)\s+(?:kids?|children|sons?|daughters?)/i,
  ];
  for (const pat of relPatterns) {
    const m = cleanText.match(pat);
    if (m && m[1]) {
      factsToSave.push(`User personal info: ${m[0].trim()}`);
    }
  }

  if (factsToSave.length === 0) return;

  try {
    const user = await User.findById(userId);
    if (!user) return;
    if (!user.memories) user.memories = [];

    let updated = false;
    for (const newFact of factsToSave) {
      // Avoid near-duplicate facts (case-insensitive compare, first 40 chars)
      const shortFact = newFact.toLowerCase().slice(0, 40);
      const exists = user.memories.some(m => m.fact.toLowerCase().slice(0, 40) === shortFact);
      if (!exists) {
        user.memories.push({ fact: newFact, createdAt: new Date() });
        updated = true;
        console.log(`[Memory]: Memorized for ${user.email}: "${newFact}"`);
      }
    }

    if (updated) await user.save();
  } catch (err) {
    console.error('[Memory Service Error]:', err.message);
  }
}

/**
 * Format user memories into a system prompt block for the AI.
 * Written to feel like genuine personal context, not a raw data dump.
 */
function formatMemoriesForPrompt(memories) {
  if (!Array.isArray(memories) || memories.length === 0) return '';

  let text = `\n\n[PERSONAL CONTEXT ABOUT THE USER — Use this naturally in conversation like a true personal assistant]:\n`;
  memories.forEach(m => {
    text += `- ${m.fact}\n`;
  });
  text += `\nIMPORTANT: Refer to the user by their name when you know it. Use these facts naturally — don't list them robotically. Personalize your answers based on this context.\n`;

  return text;
}

module.exports = {
  extractAndSaveMemory,
  formatMemoriesForPrompt
};
