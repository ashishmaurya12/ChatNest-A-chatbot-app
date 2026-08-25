const pdfModule = require('pdf-parse');
const mammoth = require('mammoth');

/**
 * Safely executes pdf-parse regardless of CommonJS vs ES export structure
 */
async function parsePdfBuffer(buffer) {
  try {
    if (typeof pdfModule === 'function') {
      const data = await pdfModule(buffer);
      return { text: data.text || '', numpages: data.numpages || 1 };
    }

    if (pdfModule && pdfModule.PDFParse) {
      const parser = new pdfModule.PDFParse({ data: buffer });
      const result = await parser.getText();
      const extractedText = result.text || (result.pages ? result.pages.map(p => p.text).join('\n') : '');
      return { text: extractedText || '', numpages: result.total || result.pages?.length || 1 };
    }

    if (pdfModule && pdfModule.default && typeof pdfModule.default === 'function') {
      const data = await pdfModule.default(buffer);
      return { text: data.text || '', numpages: data.numpages || 1 };
    }

    const classicPdfParse = require('pdf-parse/lib/pdf-parse.js');
    const data = await classicPdfParse(buffer);
    return { text: data.text || '', numpages: data.numpages || 1 };
  } catch (err) {
    console.warn('[PDF Parsing Engine Warning]:', err.message);
    // Fallback regex text string extraction from PDF binary stream
    try {
      const rawStr = buffer.toString('binary');
      const textMatches = rawStr.match(/\(([^()]+)\)\s*Tj/g) || rawStr.match(/T[dD]\s*\(([^()]+)\)/g);
      if (textMatches && textMatches.length > 0) {
        const extracted = textMatches.map(m => m.replace(/.*\(|\).*/g, '')).join(' ');
        return { text: extracted, numpages: 1 };
      }
    } catch (e) {}
    return { text: '', numpages: 1 };
  }
}

/**
 * Parses attached document or image from base64 string or raw buffer.
 * Supports PDF, DOCX, TXT, MD, CSV, JSON, Code files, and Images.
 * 
 * @param {Object} attachment - { name, mimeType, type, base64Data, text }
 * @returns {Promise<Object>} Processed attachment object with extracted text & metadata
 */
async function parseDocumentAttachment(attachment) {
  if (!attachment) return null;

  const { name, mimeType, type, base64Data, text: rawText } = attachment;

  // Handle Images directly
  if (type === 'image' || (mimeType && mimeType.startsWith('image/'))) {
    return {
      type: 'image',
      name: name || 'image.png',
      mimeType: mimeType || 'image/jpeg',
      base64Data: base64Data || null
    };
  }

  // If text is already provided cleanly (e.g. from plain text upload)
  let extractedText = rawText || '';
  let pagesCount = 1;

  try {
    let buffer = null;
    if (base64Data) {
      buffer = Buffer.from(base64Data, 'base64');
    }

    const lowerName = (name || '').toLowerCase();
    const isPdf = (mimeType && mimeType.includes('pdf')) || lowerName.endsWith('.pdf');
    const isDocx = (mimeType && (mimeType.includes('word') || mimeType.includes('officedocument'))) || lowerName.endsWith('.docx') || lowerName.endsWith('.doc');

    if (isPdf && buffer) {
      const pdfRes = await parsePdfBuffer(buffer);
      extractedText = pdfRes.text || '';
      pagesCount = pdfRes.numpages || 1;
    } else if (isDocx && buffer) {
      const docxResult = await mammoth.extractRawText({ buffer });
      extractedText = docxResult.value || '';
    } else if (buffer && (!extractedText || /[\x00-\x08\x0E-\x1F]/.test(extractedText))) {
      // UTF-8 plain text fallback for TXT, MD, CSV, JSON, JS, PY, HTML, CSS etc.
      extractedText = buffer.toString('utf-8');
    }
  } catch (err) {
    console.warn(`[DocParser Warning] Failed to parse '${name}':`, err.message);
    if (!extractedText && rawText) {
      extractedText = rawText;
    }
  }

  // Clean extracted text (remove redundant blank lines or null characters)
  const cleanedText = (extractedText || '')
    .replace(/\r\n/g, '\n')
    .replace(/\0/g, '')
    .trim();

  const wordsCount = cleanedText ? cleanedText.split(/\s+/).length : 0;
  const linesCount = cleanedText ? cleanedText.split('\n').length : 0;

  return {
    type: 'doc',
    name: name || 'Document',
    mimeType: mimeType || 'text/plain',
    text: cleanedText,
    base64Data: base64Data || null,
    metadata: {
      charCount: cleanedText.length,
      wordCount: wordsCount,
      lineCount: linesCount,
      pageCount: pagesCount
    }
  };
}

module.exports = {
  parseDocumentAttachment
};
