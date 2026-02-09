import { parsePdfToQuoteData } from './lib/pdf/parser';
import fs from 'fs';

async function test() {
  const pdfBuffer = fs.readFileSync('./test.pdf');
  const parsed = await parsePdfToQuoteData(pdfBuffer);
  
  console.log('Parsed:', parsed);
}

test();