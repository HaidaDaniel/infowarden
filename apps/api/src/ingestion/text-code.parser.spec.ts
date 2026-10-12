import { TextCodeParser } from './text-code.parser';

describe('TextCodeParser advanced document processors', () => {
  it('extracts Obsidian metadata from Markdown notes', () => {
    const parser = new TextCodeParser();
    const note = Buffer.from(
      [
        '---',
        'title: Survival Kit',
        'tags: [medicine, prep]',
        '---',
        '# Survival Kit',
        'Link to [[Medicine/Antiseptics|antiseptics]] and ![[attachments/diagram.png]].',
        'Inline #survival tag and [manual](files/manual.pdf).',
      ].join('\n'),
      'utf8',
    );

    const parsed = parser.parse(note, 'Survival Kit.md');

    expect(parsed).toMatchObject({
      mimeType: 'text/markdown',
      language: 'markdown',
      metadata: expect.objectContaining({
        processor: 'markdown_obsidian',
        frontmatter: {
          title: 'Survival Kit',
          tags: ['medicine', 'prep'],
        },
        headings: [{ level: 1, text: 'Survival Kit' }],
        obsidianTags: ['survival'],
        obsidianWikilinks: ['Medicine/Antiseptics'],
        obsidianEmbeds: ['attachments/diagram.png'],
        obsidianAttachmentRefs: ['attachments/diagram.png', 'files/manual.pdf'],
      }),
    });
  });

  it('extracts best-effort text and low-confidence warnings from PDFs', () => {
    const parser = new TextCodeParser();
    const pdf = Buffer.from(
      [
        '%PDF-1.4',
        '1 0 obj << /Type /Page >> endobj',
        '2 0 obj << /Length 40 >>',
        'stream',
        'BT (Hello PDF world from ContextForge) Tj ET',
        'endstream',
        'endobj',
        '%%EOF',
      ].join('\n'),
      'latin1',
    );

    const parsed = parser.parse(pdf, 'docs/sample.pdf');

    expect(parsed).toMatchObject({
      mimeType: 'application/pdf',
      language: 'document',
      metadata: expect.objectContaining({
        processor: 'pdf_text',
        pageCount: 1,
        extractionConfidence: 'low',
      }),
    });
    expect(parsed?.text).toContain('Hello PDF world from ContextForge');
    expect(parsed?.warnings).toEqual([
      expect.objectContaining({
        code: 'low_confidence_pdf_text',
      }),
    ]);
  });

  it('extracts DOCX document text from ZIP XML parts', () => {
    const parser = new TextCodeParser();
    const docx = buildStoredZip({
      '[Content_Types].xml': '<Types></Types>',
      'docProps/core.xml': '<cp:coreProperties><dc:title>Quarterly Notes</dc:title></cp:coreProperties>',
      'word/document.xml':
        '<w:document><w:body><w:p><w:r><w:t>Hello DOCX</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p></w:body></w:document>',
    });

    const parsed = parser.parse(docx, 'docs/notes.docx');

    expect(parsed).toMatchObject({
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      language: 'document',
      metadata: expect.objectContaining({
        processor: 'docx_text',
        title: 'Quarterly Notes',
      }),
    });
    expect(parsed?.text).toContain('Hello DOCX');
    expect(parsed?.text).toContain('Second paragraph');
  });

  it('cleans HTML down to article text and removes boilerplate script content', () => {
    const parser = new TextCodeParser();
    const html = Buffer.from(
      '<html><head><title>Useful Page</title><script>window.secret = true</script></head><body><nav>Menu</nav><article><h1>Main Story</h1><p>Keep &amp; decode this.</p></article><footer>Legal</footer></body></html>',
      'utf8',
    );

    const parsed = parser.parse(html, 'docs/page.html');

    expect(parsed).toMatchObject({
      mimeType: 'text/html',
      language: 'html',
      metadata: expect.objectContaining({
        processor: 'html_article',
        title: 'Useful Page',
      }),
    });
    expect(parsed?.text).toContain('Title: Useful Page');
    expect(parsed?.text).toContain('Main Story');
    expect(parsed?.text).toContain('Keep & decode this.');
    expect(parsed?.text).not.toContain('window.secret');
    expect(parsed?.text).not.toContain('Menu');
  });

  it('describes document-like image OCR as unavailable without enabling audio or video processors', () => {
    const parser = new TextCodeParser();

    expect(parser.parse(Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'scan.png')).toBeNull();
    expect(parser.describeParseFailure('scan.png')).toMatchObject({
      code: 'ocr_unavailable',
      metadata: {
        processor: 'ocr',
        dependencyStrategy: 'not_enabled',
      },
    });
    expect(parser.describeParseFailure('meeting.mp4')).toMatchObject({
      code: 'unsupported_file_type',
      metadata: {
        backlogOnly: true,
      },
    });
  });
});

function buildStoredZip(files: Record<string, string>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const [name, contents] of Object.entries(files)) {
    const fileName = Buffer.from(name, 'utf8');
    const data = Buffer.from(contents, 'utf8');
    const localHeader = Buffer.alloc(30);

    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(fileName.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, fileName, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(fileName.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, fileName);

    offset += localHeader.length + fileName.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(Object.keys(files).length, 8);
  endOfCentralDirectory.writeUInt16LE(Object.keys(files).length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12);
  endOfCentralDirectory.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralDirectory, endOfCentralDirectory]);
}
