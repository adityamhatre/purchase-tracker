import { PurchaseInsert } from './db';

/**
 * Helper to clean HTML content, converting tags to newlines and decoding common entities.
 */
function cleanHtmlToLines(html: string): string[] {
  if (!html) return [];
  
  // Replace HTML tags with newlines to preserve layout rows
  let text = html.replace(/<[^>]+>/g, '\n');
  
  // Decode common HTML entities
  text = text.replace(/&nbsp;/g, ' ')
             .replace(/&#x27;/g, "'")
             .replace(/&amp;/g, '&')
             .replace(/&quot;/g, '"')
             .replace(/&lt;/g, '<')
             .replace(/&gt;/g, '>');
             
  // Split into lines, trim, and filter out empty lines
  return text.split('\n')
             .map((line) => line.trim())
             .filter((line) => line.length > 0);
}

/**
 * Helper to split plain text into cleaned lines.
 */
function cleanTextToLines(plainText: string): string[] {
  if (!plainText) return [];
  return plainText.split('\n')
                  .map((line) => line.trim())
                  .filter((line) => line.length > 0);
}

/**
 * Rules-based parser for Amex transaction emails.
 * Looks for a dollar amount line. The line before is the merchant, and the line after is the date.
 */
function parseAmexContent(lines: string[], emailDate: Date): { merchant: string; amount: number; date: Date } | null {
  const invalidMerchants = [
    'manage alerts',
    'account ending',
    'large purchase notifications',
    'purchase was more than',
    'dear',
    'card member'
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match exactly a dollar amount, e.g., "$24.98", "$1,234.56*", or "15.90"
    const amountMatch = line.match(/^\$?([0-9,]+\.[0-9]{2})\*?$/);
    if (amountMatch) {
      const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
      
      // Merchant is usually the line before
      const rawMerchant = i > 0 ? lines[i - 1] : 'Unknown Merchant';
      
      // Validate merchant name
      const isInvalid = invalidMerchants.some((im) => rawMerchant.toLowerCase().includes(im));
      if (isInvalid || rawMerchant.length > 100 || rawMerchant.length < 2) {
        continue;
      }
      
      // Clean up merchant name (e.g. normalize spaces)
      const merchant = rawMerchant.replace(/\s+/g, ' ').trim();
      
      // Date is usually the line after
      const dateStr = i < lines.length - 1 ? lines[i + 1] : '';
      let date = emailDate;
      if (dateStr) {
        const parsedDate = new Date(dateStr);
        if (!isNaN(parsedDate.getTime())) {
          date = parsedDate;
        }
      }
      
      return { merchant, amount, date };
    }
  }
  
  return null;
}

/**
 * Rules-based parser that extracts purchase details from Amex transaction emails.
 * Does not use Gemini API, making it free, rate-limit-free, and extremely fast.
 */
export async function parseEmailToPurchase(
  emailId: string,
  subject: string,
  bodyText: string,
  bodyHtml: string,
  emailDate: Date
): Promise<PurchaseInsert> {
  console.log(`[Parser]: Executing rules-based Amex parser for email ${emailId}`);

  // 1. Try to clean and parse the HTML body (usually more structured)
  let lines = cleanHtmlToLines(bodyHtml);
  let parsed = parseAmexContent(lines, emailDate);
  
  // 2. Fallback to cleaning and parsing plain text if HTML parsing failed
  if (!parsed) {
    lines = cleanTextToLines(bodyText);
    parsed = parseAmexContent(lines, emailDate);
  }

  // 3. Fallback: Parse subject and body for any dollar value if strict layout parsing failed
  if (!parsed) {
    console.warn(`[Parser Warning]: Could not extract purchase details using structured layout for email ${emailId}. Running loose regex fallback.`);
    
    let fallbackAmount = 0.00;
    const searchString = `${subject} ${bodyText} ${bodyHtml}`;
    
    // Extract first occurrence of a dollar value (e.g. $15.50 or $1,200.00)
    const amountMatch = searchString.match(/\$([0-9,]+\.[0-9]{2})/);
    if (amountMatch) {
      fallbackAmount = parseFloat(amountMatch[1].replace(/,/g, ''));
    }
    
    // Attempt to identify a known merchant in the text
    let fallbackMerchant = 'American Express Purchase';
    const lowerSearch = searchString.toLowerCase();
    
    if (lowerSearch.includes('amazon')) {
      fallbackMerchant = 'Amazon';
    } else if (lowerSearch.includes('starbucks')) {
      fallbackMerchant = 'Starbucks';
    } else if (lowerSearch.includes('uber')) {
      fallbackMerchant = 'Uber';
    } else if (lowerSearch.includes('zalat')) {
      fallbackMerchant = 'Zalat Pizza';
    } else if (lowerSearch.includes('usps')) {
      fallbackMerchant = 'USPS';
    }
    
    parsed = {
      merchant: fallbackMerchant,
      amount: fallbackAmount,
      date: emailDate
    };
  }

  // Normalize merchant name (e.g., "AMAZON MARKEPLACE NA PA" -> "Amazon")
  let normalizedMerchant = parsed.merchant;
  const lowerMerchant = parsed.merchant.toLowerCase();
  
  if (lowerMerchant.includes('amazon')) {
    normalizedMerchant = 'Amazon';
  } else if (lowerMerchant.includes('starbucks')) {
    normalizedMerchant = 'Starbucks';
  } else if (lowerMerchant.includes('uber')) {
    normalizedMerchant = 'Uber';
  } else if (lowerMerchant.includes('zalat')) {
    normalizedMerchant = 'Zalat Pizza';
  } else if (lowerMerchant.includes('usps')) {
    normalizedMerchant = 'USPS';
  }

  return {
    merchant: normalizedMerchant,
    amount: parsed.amount,
    currency: 'USD', // Amex alerts default to USD, could extract if currency symbols are parsed
    purchase_date: parsed.date,
    items: [
      {
        name: parsed.merchant === normalizedMerchant ? 'Total Purchase' : parsed.merchant,
        price: parsed.amount,
        quantity: 1,
      },
    ],
    gmail_message_id: emailId,
    raw_email_subject: subject,
  };
}
