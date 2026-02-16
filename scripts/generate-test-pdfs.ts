import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

async function createTestPDF(
  outputPath: string,
  pageCount: number,
  title: string,
  description: string
) {
  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)

  for (let i = 1; i <= pageCount; i++) {
    const page = pdfDoc.addPage([612, 792]) // US Letter
    const { width, height } = page.getSize()

    // Header
    page.drawText(title, {
      x: 50,
      y: height - 50,
      size: 24,
      font,
      color: rgb(0.1, 0.1, 0.1)
    })

    // Page indicator
    page.drawText(`Page ${i} of ${pageCount}`, {
      x: 50,
      y: height - 80,
      size: 12,
      font,
      color: rgb(0.4, 0.4, 0.4)
    })

    // Description
    page.drawText(description, {
      x: 50,
      y: height - 110,
      size: 11,
      font,
      color: rgb(0.3, 0.3, 0.3)
    })

    // Content - sample text blocks
    const linesPerPage = 30
    const startY = height - 150
    const lineHeight = 18

    for (let line = 0; line < linesPerPage; line++) {
      const paragraphNum = (i - 1) * linesPerPage + line + 1
      const text = `Paragraph ${paragraphNum}: This is sample text for testing PageSonic's PDF rendering and text-to-speech capabilities. It contains enough content to demonstrate scrolling, extraction, and playback features. The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.`

      page.drawText(text.substring(0, 85) + (text.length > 85 ? '...' : ''), {
        x: 50,
        y: startY - line * lineHeight,
        size: 9,
        font,
        color: rgb(0.2, 0.2, 0.2)
      })
    }
  }

  pdfDoc.setTitle(title)
  pdfDoc.setAuthor('PageSonic Test Fixture')
  pdfDoc.setSubject(`Test PDF with ${pageCount} pages`)

  const pdfBytes = await pdfDoc.save()
  const fs = await import('fs')
  fs.writeFileSync(outputPath, pdfBytes)
  console.log(`Created: ${outputPath} (${pageCount} pages, ${(pdfBytes.length / 1024).toFixed(1)} KB)`)
}

async function main() {
  const fixturesDir = 'public/fixtures'

  console.log('Generating test PDF fixtures...\n')

  // Short PDF: 3 pages - quick tests
  await createTestPDF(
    `${fixturesDir}/test-short.pdf`,
    3,
    'Test Document (Short)',
    '3-page document for quick browser verification tests'
  )

  // Medium PDF: 15 pages - typical document
  await createTestPDF(
    `${fixturesDir}/test-medium.pdf`,
    15,
    'Test Document (Medium)',
    '15-page document for standard testing scenarios'
  )

  // Long PDF: 50 pages - stress testing
  await createTestPDF(
    `${fixturesDir}/test-long.pdf`,
    50,
    'Test Document (Long)',
    '50-page document for scroll performance and extraction testing'
  )

  console.log('\nDone! Test PDFs created in public/fixtures/')
}

main().catch(console.error)
