// converters/enex-converter.js
class EnexConverter {
  // Logic to READ .enex files (placeholder for now)
  async parse(files) {
    // This will be complex. It involves reading XML, parsing notes,
    // and decoding base64 attachments.
    console.log("Parsing ENEX files...", files);
    alert("Importing from .enex is not yet implemented.");
    return []; // Return an array of standardized note objects
  }

  // Logic to WRITE .enex files
  async generate(notes) {
    const currentDate = dayjs().format('YYYYMMDDTHHmmssZ');
    let enexContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export3.dtd">
<en-export export-date="${currentDate}" application="NoteMigrator" version="1.0">`;

    for (const note of notes) {
      enexContent += this.createNoteXml(note);
    }

    enexContent += '</en-export>';
    return enexContent;
  }

  createNoteXml(note) {
    const created = dayjs(note.created).format('YYYYMMDDTHHmmssZ');
    const updated = dayjs(note.updated).format('YYYYMMDDTHHmmssZ');
    const tagsXml = note.tags.map(tag => `<tag>${this.escapeXml(tag)}</tag>`).join('');

    // Convert note content to ENML (Evernote's HTML subset)
    const content = this.formatContentForEnex(note.content);
    
    return `
  <note>
    <title>${this.escapeXml(note.title)}</title>
    <content><![CDATA[<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">
<en-note>${content}</en-note>]]></content>
    <created>${created}</created>
    <updated>${updated}</updated>
    ${tagsXml}
  </note>`;
  }
  
  formatContentForEnex(htmlContent) {
    // Basic formatting, can be expanded
    // For now, just wrap in a div. A more robust solution would
    // sanitize and format HTML to conform to the ENML DTD.
    return `<div>${htmlContent.replace(/<br>/g, '<br/>')}</div>`;
  }

  escapeXml(unsafe) {
    if (typeof unsafe !== 'string') return '';
    return unsafe.replace(/[<>&'"]/g, c => {
      switch (c) {
        case '<': return '<';
        case '>': return '>';
        case '&': return '&';
        case '\'': return '\'';
        case '"': return '"';
      }
    });
  }
}